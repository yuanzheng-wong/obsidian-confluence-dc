// Populated by storageToMd before each parse; single-threaded so module-level state is safe.
let _mermaidComments: Record<string, string> = {};

export function storageToMd(storage: string, mermaidComments: Record<string, string> = {}): string {
  _mermaidComments = mermaidComments;
  const parser = new DOMParser();
  // Wrap in a div so the root is a single element
  const doc = parser.parseFromString(
    `<div>${storage}</div>`,
    'text/html'
  );
  const root = doc.body.firstElementChild;
  if (!root) return '';
  return walkNodes(root.childNodes).trim() + '\n';
}

function walkNodes(nodes: NodeList): string {
  let out = '';
  nodes.forEach((n) => { out += walkNode(n); });
  return out;
}

function walkNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'h1': return `# ${walkNodes(el.childNodes).trim()}\n\n`;
    case 'h2': return `## ${walkNodes(el.childNodes).trim()}\n\n`;
    case 'h3': return `### ${walkNodes(el.childNodes).trim()}\n\n`;
    case 'h4': return `#### ${walkNodes(el.childNodes).trim()}\n\n`;
    case 'h5': return `##### ${walkNodes(el.childNodes).trim()}\n\n`;
    case 'h6': return `###### ${walkNodes(el.childNodes).trim()}\n\n`;
    case 'p':  return `${walkNodes(el.childNodes).trim()}\n\n`;
    case 'strong': return `**${walkNodes(el.childNodes)}**`;
    case 'b':      return `**${walkNodes(el.childNodes)}**`;
    case 'em':     return `*${walkNodes(el.childNodes)}*`;
    case 'i':      return `*${walkNodes(el.childNodes)}*`;
    case 'del':    return `~~${walkNodes(el.childNodes)}~~`;
    case 'mark':   return `==${walkNodes(el.childNodes)}==`;
    case 'code':   return `\`${el.textContent}\``;
    case 'hr':     return `---\n\n`;
    case 'br':     return '\n';
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const text = walkNodes(el.childNodes).trim();
      return `[${text}](${href})`;
    }
    case 'ul': return walkList(el, false) + '\n';
    case 'ol': return walkList(el, true) + '\n';
    case 'li': return walkNodes(el.childNodes).trim();
    case 'table': return walkTable(el) + '\n';
    case 'tbody': return walkNodes(el.childNodes);
    case 'thead': return walkNodes(el.childNodes);
    case 'blockquote': {
      const inner = walkNodes(el.childNodes).trim();
      return inner.split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
    }

    // Confluence macros
    case 'ac:structured-macro': return walkMacro(el);
    case 'ac:rich-text-body':   return walkNodes(el.childNodes);
    case 'ac:plain-text-body':  return el.textContent ?? '';
    case 'ac:link': {
      const page = el.querySelector('ri\\:page');
      const title = page?.getAttribute('ri:content-title') ?? '';
      const alias = el.querySelector('ac\\:link-body')?.textContent;
      return alias ? `[${alias}](${title})` : title;
    }
    case 'ac:image': {
      const riAttach = el.querySelector('ri\\:attachment');
      if (riAttach) {
        const filename = riAttach.getAttribute('ri:filename') ?? '';
        const mermaidSource = _mermaidComments[filename];
        if (mermaidSource) {
          return `\`\`\`mermaid\n${mermaidSource}\n\`\`\`\n\n`;
        }
        return `![[${filename}]]`;
      }
      const riUrl = el.querySelector('ri\\:url');
      const src = riUrl?.getAttribute('ri:value') ?? '';
      return `![](${src})`;
    }

    default:
      return walkNodes(el.childNodes);
  }
}

function walkMacro(el: Element): string {
  const name = el.getAttribute('ac:name');

  switch (name) {
    case 'code': {
      const lang =
        el
          .querySelector('ac\\:parameter[ac\\:name="language"]')
          ?.textContent?.trim() ?? '';
      const body =
        el.querySelector('ac\\:plain-text-body')?.textContent ?? '';
      return `\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
    }

    case 'info':
    case 'note':
    case 'tip':
    case 'warning': {
      const body = el.querySelector('ac\\:rich-text-body');
      if (!body) return '';
      const inner = walkNodes(body.childNodes).trim();
      return inner.split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
    }

    case 'noformat': {
      const body = el.querySelector('ac\\:plain-text-body')?.textContent ?? '';
      return `\`\`\`\n${body}\n\`\`\`\n\n`;
    }

    case 'jira': {
      const key = el.querySelector('ac\\:parameter[ac\\:name="key"]')?.textContent?.trim() ?? '';
      return key ? `[JIRA:${key}]` : '';
    }

    default: {
      const rich = el.querySelector('ac\\:rich-text-body');
      return rich ? walkNodes(rich.childNodes) : '';
    }
  }
}

function walkList(el: Element, ordered: boolean): string {
  let result = '';
  let counter = 1;
  el.querySelectorAll(':scope > li').forEach((li) => {
    const prefix = ordered ? `${counter++}. ` : '- ';
    const content = walkNodes(li.childNodes)
      .trim()
      .replace(/\n{2,}/g, '\n');
    // Indent continuation lines
    const indented = content
      .split('\n')
      .map((l, i) => (i === 0 ? l : `   ${l}`))
      .join('\n');
    result += `${prefix}${indented}\n`;
  });
  return result;
}

function walkTable(el: Element): string {
  const rows: string[][] = [];
  el.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('th, td').forEach((td) => {
      cells.push(walkNodes(td.childNodes).trim().replace(/\n+/g, ' '));
    });
    rows.push(cells);
  });

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  let out = '';

  rows.forEach((row, i) => {
    const padded = [
      ...row,
      ...Array<string>(colCount - row.length).fill(''),
    ];
    out += `| ${padded.join(' | ')} |\n`;
    if (i === 0) {
      out += `| ${Array<string>(colCount).fill('---').join(' | ')} |\n`;
    }
  });

  return out;
}
