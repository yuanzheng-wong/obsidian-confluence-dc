import { App, TFile, Vault } from 'obsidian';
import { ConfluenceClient } from '../api/client';
import { ConfluencePage } from '../api/types';
import { mdToStorage } from '../convert/md-to-storage';
import { ConfluenceSettings, FileMapping } from '../settings';
import { FileSyncRecord, StateManager, hashContent } from './state';
import { findLocalImages, buildImageMap, pushAttachments, pushMermaidDiagrams } from './attachments';
import { stripFrontmatter } from './frontmatter';

export class ConflictError extends Error {
  constructor(
    public filePath: string,
    public record: FileSyncRecord,
    public remotePage: ConfluencePage
  ) {
    super(`Conflict on ${filePath}: both local and remote have changed since last sync`);
  }
}

function pageTitle(file: TFile, mapping: FileMapping): string {
  return mapping.titleOverride ?? file.basename;
}

export async function pushFile(
  filePath: string,
  mapping: FileMapping,
  vault: Vault,
  app: App,
  client: ConfluenceClient,
  stateManager: StateManager,
  force: 'local' | 'remote' | 'none' = 'none',
  onProgress?: (msg: string) => void | Promise<void>,
  settings?: ConfluenceSettings
): Promise<ConfluencePage> {
  const file = vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) throw new Error(`Not a file: ${filePath}`);

  const content = await vault.read(file);
  const body = stripFrontmatter(content);
  const localHash = await hashContent(body);
  const title = pageTitle(file, mapping);
  const record = stateManager.get(filePath);

  // Resolve local images before converting
  await onProgress?.('Converting markdown…');
  const images = findLocalImages(body, vault, filePath);
  const imageMap = buildImageMap(images);
  const jiraParams = settings?.jiraServer && settings?.jiraServerId
    ? { server: settings.jiraServer, serverId: settings.jiraServerId }
    : undefined;
  const { storage: rawStorage, mermaidSources } = mdToStorage(body, imageMap, jiraParams);

  // Replace <!--MERMAID:N--> sentinels with ac:image references.
  // SVGs are uploaded after the page upsert (Confluence resolves by filename at render time).
  const storageBody = resolveMermaidSentinels(rawStorage, mermaidSources);

  if (record) {
    await onProgress?.('Checking remote page…');
    const remotePage = await client.getPage(record.pageId);
    const remoteHash = await hashContent(remotePage.body.storage.value);
    const localChanged = localHash !== record.localHash;
    const remoteChanged = remoteHash !== record.remoteHash;

    if (localChanged && remoteChanged && force === 'none') {
      throw new ConflictError(filePath, record, remotePage);
    }

    await onProgress?.('Updating page…');
    const updated = await client.updatePage(record.pageId, {
      type: 'page',
      title,
      version: { number: remotePage.version.number + 1 },
      body: { storage: { value: storageBody, representation: 'storage' } },
    });

    const attachments = await pushAttachments(
      updated.id, images, vault, client, record.attachments ?? {}, onProgress
    );
    const { attachments: mermaidAtts } = mermaidSources.length
      ? await pushMermaidDiagrams(updated.id, mermaidSources, client, record.attachments ?? {}, app, onProgress)
      : { attachments: {} };

    const newRemoteHash = await hashContent(updated.body?.storage?.value ?? storageBody);
    await stateManager.set(filePath, {
      pageId: updated.id,
      pageVersion: updated.version?.number ?? remotePage.version.number + 1,
      localHash,
      remoteHash: newRemoteHash,
      lastSynced: new Date().toISOString(),
      spaceKey: mapping.spaceKey,
      pageTitle: title,
      pageUrl: client.webUrl(updated),
      attachments: { ...attachments, ...mermaidAtts },
    });

    return updated;
  }

  // First push — adopt existing page or create new
  await onProgress?.('Checking for existing page…');
  let page = await client.findPageByTitle(mapping.spaceKey, title);

  if (page) {
    await onProgress?.('Updating existing page…');
    page = await client.updatePage(page.id, {
      type: 'page',
      title,
      version: { number: page.version.number + 1 },
      body: { storage: { value: storageBody, representation: 'storage' } },
    });
  } else {
    onProgress?.('Creating page…');
    page = await client.createPage({
      type: 'page',
      title,
      space: { key: mapping.spaceKey },
      ancestors: mapping.parentPageId ? [{ id: mapping.parentPageId }] : undefined,
      body: { storage: { value: storageBody, representation: 'storage' } },
    });
  }

  const attachments = await pushAttachments(page.id, images, vault, client, {}, onProgress);
  const { attachments: mermaidAtts } = mermaidSources.length
    ? await pushMermaidDiagrams(page.id, mermaidSources, client, {}, app, onProgress)
    : { attachments: {} };

  const remoteHash = await hashContent(page.body?.storage?.value ?? storageBody);
  await stateManager.set(filePath, {
    pageId: page.id,
    pageVersion: page.version?.number ?? 1,
    localHash,
    remoteHash,
    lastSynced: new Date().toISOString(),
    spaceKey: mapping.spaceKey,
    pageTitle: title,
    pageUrl: client.webUrl(page),
    attachments: { ...attachments, ...mermaidAtts },
  });

  return page;
}

function resolveMermaidSentinels(storage: string, mermaidSources: string[]): string {
  let result = storage;
  mermaidSources.forEach((_, idx) => {
    result = result.replace(
      `<!--MERMAID:${idx}-->`,
      `<ac:image><ri:attachment ri:filename="mermaid-diagram-${idx}.svg"/></ac:image>`
    );
  });
  return result;
}
