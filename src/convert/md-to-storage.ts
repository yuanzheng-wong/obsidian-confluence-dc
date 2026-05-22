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
      const joined = paraLines
        .map((l, idx) => {
          if (idx === paraLines.length - 1) return l;
          if (l.endsWith('\\')) return l.slice(0, -1) + '<br/>';
          if (l.endsWith('  ')) return l.trimEnd() + '<br/>';
          return l + ' ';
        })
        .join('');
      blocks.push(`<p>${inline(joined)}</p>`);
    }
  }

  return blocks.join('\n');
}

function codeBlock(lang: string, code: string): string {
  // Escape any CDATA-ending sequence inside the code
  const safe = code.replace(/]]>/g, ']]]]><![CDATA[>');
  const langParam = lang
    ? `<ac:parameter ac:name="language">${escXml(lang)}</ac:parameter>`
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

/** Escape characters that are invalid in XHTML text nodes. */
function escXml(s: string): string {
  return s
    .replace(/&(?![a-zA-Z#]\w{0,10};)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Escape for use inside an XML attribute value (double-quoted). */
function escAttr(s: string): string {
  return escXml(s).replace(/"/g, '&quot;');
}

function makeInline(imageMap: Record<string, string>) {
  return function inline(text: string): string {
    const stash: string[] = [];
    const stashXml = (xml: string) => {
      const idx = stash.push(xml) - 1;
      return `\x00${idx}\x00`;
    };

    // 1. Stash images — valid XML, must not be escaped below.
    text = text.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, ref) => {
      const filename = imageMap[ref.trim()];
      return stashXml(filename
        ? `<ac:image><ri:attachment ri:filename="${escAttr(filename)}"/></ac:image>`
        : '');
    });
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, _alt, src) => {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        return stashXml(`<ac:image><ri:url ri:value="${escAttr(src)}"/></ac:image>`);
      }
      const filename = imageMap[src.trim()];
      return stashXml(filename
        ? `<ac:image><ri:attachment ri:filename="${escAttr(filename)}"/></ac:image>`
        : '');
    });

    // 2. Stash inline code with escaped content so < > inside backticks
    //    don't become unmatched XHTML tags.
    text = text.replace(/`([^`]+)`/g, (_, code) =>
      stashXml(`<code>${escXml(code)}</code>`)
    );

    // 3. Escape raw text — stash placeholders (\x00N\x00) contain no < > &
    //    so they pass through untouched.
    text = escXml(text);

    // 4. Wikilinks (non-image): [[target|alias]] or [[target]]
    //    Targets/aliases are already escaped from step 3.
    text = text.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, target, alias) => alias ?? target
    );

    // 5. Inline formatting — patterns don't conflict with XML entities.
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    text = text.replace(/==(.+?)==/g, '<mark>$1</mark>');

    // 6. Links — URL is already &amp;-escaped from step 3, correct for href.
    text = text.replace(
      /(?<!!)(\[([^\]]+)\])\(([^)]+)\)/g,
      (_, _full, label, href) => `<a href="${href}">${label}</a>`
    );

    // 7. Restore stashed XML.
    text = text.replace(/\x00(\d+)\x00/g, (_, idx) => stash[Number(idx)]);

    return text;
  };
}
