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

    // Callout / blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(blockquote(quoteLines, imageMap));
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

    // Task list
    if (line.match(/^(\s*)[*+-] \[[ x]\] /i)) {
      const taskLines: string[] = [];
      while (i < lines.length && lines[i].match(/^(\s*)[*+-] \[[ x]\] /i)) {
        taskLines.push(lines[i]);
        i++;
      }
      blocks.push(taskList(taskLines, inline));
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

  // Strip any null bytes that leaked through (invalid in XHTML).
  return blocks.join('\n').replace(/\x00/g, '');
}

function codeBlock(lang: string, code: string): string {
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

const CALLOUT_MACRO: Record<string, string> = {
  note:      'note',
  info:      'info',
  tip:       'tip',
  hint:      'tip',
  important: 'info',
  warning:   'warning',
  caution:   'warning',
  danger:    'warning',
  error:     'warning',
  success:   'tip',
  check:     'tip',
  question:  'info',
  quote:     'info',
  cite:      'info',
  abstract:  'info',
  summary:   'info',
  todo:      'note',
  failure:   'warning',
  bug:       'warning',
  example:   'note',
};

function blockquote(quoteLines: string[], imageMap: Record<string, string>): string {
  // Obsidian callout: first line is [!TYPE] optional title
  const calloutMatch = quoteLines[0]?.match(/^\[!(\w+)\][\s-]*(.*)/i);
  if (calloutMatch) {
    const type = calloutMatch[1].toLowerCase();
    const title = calloutMatch[2].trim();
    const macro = CALLOUT_MACRO[type] ?? 'info';
    const bodyLines = quoteLines.slice(1);
    const body = bodyLines.length
      ? mdToStorage(bodyLines.join('\n'), imageMap)
      : '';
    const titleParam = title
      ? `<ac:parameter ac:name="title">${escXml(title)}</ac:parameter>`
      : '';
    return (
      `<ac:structured-macro ac:name="${macro}">` +
      titleParam +
      `<ac:rich-text-body>${body}</ac:rich-text-body>` +
      `</ac:structured-macro>`
    );
  }

  // Plain blockquote
  const inner = mdToStorage(quoteLines.join('\n'), imageMap);
  return (
    `<ac:structured-macro ac:name="info">` +
    `<ac:rich-text-body>${inner}</ac:rich-text-body>` +
    `</ac:structured-macro>`
  );
}

function table(lines: string[], inline: (s: string) => string): string {
  const rows = lines.filter((l) => !l.match(/^\|?[\s|:-]+\|?\s*$/));

  let html = '<table><tbody>';
  rows.forEach((row, rowIdx) => {
    const cells = row
      .split('|')
      .slice(1, -1)
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

function taskList(lines: string[], inline: (s: string) => string): string {
  let html = '<ac:task-list>';
  for (const line of lines) {
    const m = line.match(/^(\s*)[*+-] \[([ x])\] (.*)$/i);
    if (!m) continue;
    const checked = m[2].toLowerCase() === 'x';
    const status = checked ? 'complete' : 'incomplete';
    html +=
      `<ac:task>` +
      `<ac:task-status>${status}</ac:task-status>` +
      `<ac:task-body>${inline(m[3])}</ac:task-body>` +
      `</ac:task>`;
  }
  html += '</ac:task-list>';
  return html;
}

interface ListItem {
  depth: number;
  text: string;
  ordered: boolean;
}

function list(lines: string[], ordered: boolean, inline: (s: string) => string): string {
  const items: ListItem[] = [];

  for (const line of lines) {
    const unordered = line.match(/^(\s*)[*+-] (.*)$/);
    const orderedMatch = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    const match = unordered ?? orderedMatch;
    if (match) {
      const depth = Math.floor(match[1].length / 2);
      items.push({ depth, text: match[2], ordered: !!orderedMatch });
    }
    // continuation lines (indented content) are appended to the last item
    else if (items.length > 0) {
      items[items.length - 1].text += ' ' + line.trim();
    }
  }

  return renderListItems(items, 0, ordered, inline).html;
}

function renderListItems(
  items: ListItem[],
  start: number,
  ordered: boolean,
  inline: (s: string) => string
): { html: string; next: number } {
  const tag = ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  let i = start;

  while (i < items.length) {
    const item = items[i];
    if (item.depth < (start === 0 ? 0 : items[start - 1]?.depth ?? 0)) break;

    html += `<li><p>${inline(item.text)}</p>`;

    // Check if next item is deeper (nested list)
    if (i + 1 < items.length && items[i + 1].depth > item.depth) {
      const nested = renderListItems(items, i + 1, items[i + 1].ordered, inline);
      html += nested.html;
      i = nested.next;
    } else {
      i++;
    }

    html += '</li>';

    // Stop if next item is shallower
    if (i < items.length && items[i].depth < item.depth) break;
  }

  html += `</${tag}>`;
  return { html, next: i };
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
    // Use Unicode private-use chars as delimiters — valid XHTML, never appear in markdown.
    const stashXml = (xml: string) => {
      const idx = stash.push(xml) - 1;
      return `${idx}`;
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

    // 2. Stash embedded notes ![[note.md]] (no image extension) — render as plain text link.
    text = text.replace(/!\[\[([^\]|]+\.md)(?:\|([^\]]*))?\]\]/g, (_, target, alias) =>
      stashXml(`<em>${escXml(alias ?? target.replace(/\.md$/, ''))}</em>`)
    );

    // 3. Stash inline code with escaped content.
    text = text.replace(/`([^`]+)`/g, (_, code) =>
      stashXml(`<code>${escXml(code)}</code>`)
    );

    // 4. Escape raw text — stash placeholders contain no < > & so pass through.
    text = escXml(text);

    // 5. Wikilinks (non-image): [[target|alias]] or [[target]]
    text = text.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (_, target, alias) => alias ?? target
    );

    // 6. Inline formatting.
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
    text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
    text = text.replace(/==(.+?)==/g, '<mark>$1</mark>');

    // 7. Links — URL already &amp;-escaped from step 4, correct for href.
    text = text.replace(
      /(?<!!)(\[([^\]]+)\])\(([^)]+)\)/g,
      (_, _full, label, href) => `<a href="${href}">${label}</a>`
    );

    // 8. Restore stashed XML.
    text = text.replace(/(\d+)/g, (_, idx) => stash[Number(idx)] ?? '');

    return text;
  };
}
