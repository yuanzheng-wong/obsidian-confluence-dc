import { TFile, Vault } from 'obsidian';
import { ConfluenceClient } from '../api/client';
import { ConfluencePage } from '../api/types';
import { mdToStorage } from '../convert/md-to-storage';
import { FileMapping } from '../settings';
import { FileSyncRecord, StateManager, hashContent } from './state';
import { findLocalImages, buildImageMap, pushAttachments } from './attachments';
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
  client: ConfluenceClient,
  stateManager: StateManager,
  force: 'local' | 'remote' | 'none' = 'none',
  onProgress?: (msg: string) => void | Promise<void>
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
  const storageBody = mdToStorage(body, imageMap);

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
      attachments,
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
    attachments,
  });

  return page;
}
