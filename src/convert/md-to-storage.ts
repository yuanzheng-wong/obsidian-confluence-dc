// imageMap: maps markdown image ref (inside ![[]] or src of ![](local)) → Confluence attachment filename
export function mdToStorage(markdown: string, imageMap: Record<string, string> = {}): string {
  const inline = makeInline(imageMap);

  // Strip YAML frontmatter
  let content = markdown.replace(/^---\n[\s\S]*?\n---\n?/, '').trimStart();

  const blocks: string[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^(`{3,}|~{3,})(.*)/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const lang = fenceMatch[2].trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(codeBlock(lang, codeLines.join('\n')));
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (line.match(/^(\s*[-*_]){3,}\s*$/)) {
      blocks.push('<hr/>');
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const inner = mdToStorage(quoteLines.join('\n'), imageMap);
      blocks.push(
        `<ac:structured-macro ac:name="info"><ac:rich-text-body>${inner}</ac:rich-text-body></ac:structured-macro>`
      );
      continue;
    }

    // Table (detect by pipe + separator row)
    if (line.includes('|') && lines[i + 1]?.match(/^\|?[\s|:-]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push(table(tableLines, inline));
      continue;
    }

    // Unordered list
    if (line.match(/^(\s*)[*+-] /)) {
      const listLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i].match(/^(\s*)[*+-] /) || lines[i].match(/^\s{2,}\S/))
      ) {
        listLines.push(lines[i]);
        i++;
      }
      blocks.push(list(listLines, false, inline));
      continue;
    }

    // Ordered list
    if (line.match(/^(\s*)\d+[.)]\s/)) {
      const listLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i].match(/^(\s*)\d+[.)]\s/) || lines[i].match(/^\s{2,}\S/))
      ) {
        listLines.push(lines[i]);
        i++;
      }
      blocks.push(list(listLines, true, inline));
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect until blank or block-level element starts
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^(`{3,}|~{3,})/) &&
      !lines[i].startsWith('>') &&
      !lines[i].match(/^(\s*)[*+-] /) &&
      !lines[i].match(/^(\s*)\d+[.)]\s/) &&
      !lines[i].match(/^(\s*[-*_]){3,}\s*$/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(`<p>${inline(paraLines.join(' '))}</p>`);
    }
  }

  return blocks.join('\n');
}

function codeBlock(lang: string, code: string): string {
  // Escape any CDATA-ending sequence inside the code
  const safe = code.replace(/]]>/g, ']]]]><![CDATA[>');
  const langParam = lang
    ? `<ac:parameter ac:name="language">${lang}</ac:parameter>`
    : '';
  return (
    `<ac:structured-macro ac:name="code">` +
    langParam +
    `<ac:plain-text-body><![CDATA[${safe}]]></ac:plain-text-body>` +
    `</ac:structured-macro>`
  );
}

function table(lines: string[], inline: (s: string) => string): string {
  // Filter out separator row
  const rows = lines.filter((l) => !l.match(/^\|?[\s|:-]+\|?\s*$/));

  let html = '<table><tbody>';
  rows.forEach((row, rowIdx) => {
    const cells = row
      .split('|')
      .slice(1, -1) // strip leading/trailing empty from pipes
      .map((c) => c.trim());
    const tag = rowIdx === 0 ? 'th' : 'td';
    html += '<tr>';
    cells.forEach((cell) => {
      html += `<${tag}><p>${inline(cell)}</p></${tag}>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function list(lines: string[], ordered: boolean, inline: (s: string) => string): string {
  const tag = ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;

  for (const line of lines) {
    const match = line.match(/^(\s*)(?:[*+-]|\d+[.)])\s+(.*)$/);
    if (match) {
      html += `<li><p>${inline(match[2])}</p></li>`;
    }
  }

  html += `</${tag}>`;
  return html;
}

function makeInline(imageMap: Record<string, string>) {
  return function inline(text: string): string {
    // Stash images as null-byte placeholders so text-formatting regexes
    // can't corrupt filenames (e.g. _italic_ matching inside ri:filename="...").
    const stash: string[] = [];
    const stashImg = (xml: string) => {
      const idx = stash.push(xml) - 1;
      return `\x00${idx}\x00`;
    };

    // Wikilink images: ![[image.png]] or ![[image.png|alt]]
    text = text.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, ref) => {
      const filename = imageMap[ref.trim()];
      return stashImg(filename
        ? `<ac:image><ri:attachment ri:filename="${filename}"/></ac:image>`
        : '');
    });

    // Standard images: ![alt](src)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, _alt, src) => {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        return stashImg(`<ac:image><ri:url ri:value="${src}"/></ac:image>`);
      }
      const filename = imageMap[src.trim()];
      return stashImg(filename
        ? `<ac:image><ri:attachment ri:filename="${filename}"/></ac:image>`
        : '');
    });

    // Wikilinks (non-image): [[target|alias]] or [[target]]
    text = text.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, target, alias) => alias ?? target
    );

    // Bold+italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

    // Strikethrough
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

    // Highlight
    text = text.replace(/==(.+?)==/g, '<mark>$1</mark>');

    // Inline code (before links to avoid clashes)
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Links (not images)
    text = text.replace(
      /(?<!!)(\[([^\]]+)\])\(([^)]+)\)/g,
      '<a href="$3">$2</a>'
    );

    // Restore stashed images
    text = text.replace(/\x00(\d+)\x00/g, (_, idx) => stash[Number(idx)]);

    return text;
  };
}
