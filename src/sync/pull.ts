import { TFile, Vault } from 'obsidian';
import { ConfluenceClient } from '../api/client';
import { storageToMd } from '../convert/storage-to-md';
import { FileMapping, ConfluenceSettings } from '../settings';
import { FileSyncRecord, StateManager, hashContent } from './state';
import { ConflictError } from './push';
import { pullAttachments } from './attachments';
import { extractFrontmatterBlock, stripFrontmatter } from './frontmatter';

export async function pullFile(
  filePath: string,
  mapping: FileMapping,
  vault: Vault,
  client: ConfluenceClient,
  stateManager: StateManager,
  settings: ConfluenceSettings,
  force: 'local' | 'remote' | 'none' = 'none'
): Promise<void> {
  const record = stateManager.get(filePath);
  if (!record) {
    throw new Error(`${filePath} has no sync record — push it first to establish the link`);
  }

  const remotePage = await client.getPage(record.pageId);
  const remoteHash = await hashContent(remotePage.body.storage.value);

  const file = vault.getAbstractFileByPath(filePath);
  const localContent = file instanceof TFile ? await vault.read(file) : '';
  const localHash = await hashContent(stripFrontmatter(localContent));

  const localChanged = localHash !== record.localHash;
  const remoteChanged = remoteHash !== record.remoteHash;

  if (localChanged && remoteChanged && force === 'none') {
    throw new ConflictError(filePath, record, remotePage);
  }

  // Sync attachments regardless of whether text changed
  const attachments = await pullAttachments(
    record.pageId, vault, client, settings.attachmentsFolder, record.attachments ?? {}
  );

  if (!remoteChanged && force === 'none') {
    // Text unchanged but attachments may have been updated
    if (attachments !== record.attachments) {
      await stateManager.set(filePath, { ...record, attachments });
    }
    return;
  }

  // Build mermaid source map so storageToMd can reconstruct mermaid code blocks
  const mermaidComments: Record<string, string> = {};
  for (const rec of Object.values(attachments)) {
    if (rec.mermaidSource) mermaidComments[rec.filename] = rec.mermaidSource;
  }

  const pulledBody = storageToMd(remotePage.body.storage.value, mermaidComments);
  const existingFm = extractFrontmatterBlock(localContent);
  const mdContent = existingFm ? existingFm + pulledBody : pulledBody;

  if (file instanceof TFile) {
    await vault.modify(file, mdContent);
  } else {
    await ensureFolders(vault, filePath);
    await vault.create(filePath, mdContent);
  }

  const newLocalHash = await hashContent(pulledBody);
  await stateManager.set(filePath, {
    ...record,
    pageVersion: remotePage.version.number,
    localHash: newLocalHash,
    remoteHash,
    lastSynced: new Date().toISOString(),
    pageTitle: remotePage.title,
    pageUrl: client.webUrl(remotePage),
    attachments,
  });
}

async function ensureFolders(vault: Vault, filePath: string): Promise<void> {
  const parts = filePath.split('/');
  parts.pop();
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try { await vault.createFolder(current); } catch { /* exists */ }
  }
}
