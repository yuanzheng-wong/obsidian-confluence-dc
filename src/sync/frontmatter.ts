import { App, TFile } from 'obsidian';
import { FileMapping } from '../settings';

export interface ConfluenceFrontmatter {
  spaceKey?: string;
  parentId?: string;
  pageId?: string;
  titleOverride?: string;
}

export function readConfluenceFrontmatter(app: App, file: TFile): ConfluenceFrontmatter {
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter ?? {};
  const str = (v: unknown) => (v != null && v !== '' ? String(v) : undefined);
  return {
    spaceKey: str(fm['confluence-space-key']),
    parentId: str(fm['confluence-parent-id']),
    pageId: str(fm['confluence-page-id']),
    titleOverride: str(fm['confluence-title']),
  };
}

export async function writeConfluenceFrontmatter(
  app: App,
  file: TFile,
  updates: Partial<ConfluenceFrontmatter>
): Promise<void> {
  await app.fileManager.processFrontMatter(file, (fm) => {
    if ('spaceKey' in updates) {
      if (updates.spaceKey) fm['confluence-space-key'] = updates.spaceKey;
      else delete fm['confluence-space-key'];
    }
    if ('parentId' in updates) {
      if (updates.parentId) fm['confluence-parent-id'] = updates.parentId;
      else delete fm['confluence-parent-id'];
    }
    if ('pageId' in updates) {
      if (updates.pageId) fm['confluence-page-id'] = updates.pageId;
      else delete fm['confluence-page-id'];
    }
    if ('titleOverride' in updates) {
      if (updates.titleOverride) fm['confluence-title'] = updates.titleOverride;
      else delete fm['confluence-title'];
    }
  });
}

/** Write placeholder keys so the user can fill them in. */
export async function scaffoldConfluenceFrontmatter(app: App, file: TFile): Promise<void> {
  // processFrontMatter strips null/empty values so nothing gets written.
  // Write directly so the keys land on disk as `key: ` (empty but present).
  await app.vault.process(file, (content) => {
    if (content.includes('confluence-space-key:')) return content;
    const block = 'confluence-space-key: \nconfluence-parent-id: \nconfluence-title: \n';
    if (content.startsWith('---\n')) {
      return content.replace(/^---\n/, `---\n${block}`);
    }
    return `---\n${block}---\n\n${content}`;
  });
}

export function frontmatterToMapping(fm: ConfluenceFrontmatter, filePath: string): FileMapping | null {
  // parentId is only required for creating new pages; existing pages (pageId known) don't need it.
  if (!fm.spaceKey) return null;
  if (!fm.parentId && !fm.pageId) return null;
  return {
    id: `fm:${filePath}`,
    localPath: filePath,
    spaceKey: fm.spaceKey,
    parentPageId: fm.parentId ?? '',
    pageId: fm.pageId,
    titleOverride: fm.titleOverride,
    recursive: false,
  };
}

/** Returns content with the YAML frontmatter block removed. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

/** Returns the YAML frontmatter block (including delimiters and trailing newline), or '' if none. */
export function extractFrontmatterBlock(content: string): string {
  if (!content.startsWith('---')) return '';
  const end = content.indexOf('\n---', 3);
  if (end === -1) return '';
  return content.slice(0, end + 4) + '\n';
}
