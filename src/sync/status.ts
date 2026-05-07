import { TFile, Vault } from 'obsidian';
import { ConfluenceClient } from '../api/client';
import { FileMapping } from '../settings';
import { FileSyncRecord, StateManager, hashContent } from './state';

export type FileStatus =
  | 'synced'
  | 'ahead'         // local changed, remote unchanged
  | 'behind'        // remote changed, local unchanged
  | 'conflicted'    // both changed
  | 'new'           // mapped but never pushed
  | 'remote-only';  // exists on remote, not yet pulled

export interface StatusEntry {
  filePath: string;
  status: FileStatus;
  record?: FileSyncRecord;
  localHash?: string;
  remoteVersion?: number;
}

export async function computeStatus(
  mappings: FileMapping[],
  vault: Vault,
  client: ConfluenceClient,
  stateManager: StateManager
): Promise<StatusEntry[]> {
  const entries: StatusEntry[] = [];

  for (const mapping of mappings) {
    const files = await resolveFiles(mapping, vault);

    for (const filePath of files) {
      const record = stateManager.get(filePath);
      const file = vault.getAbstractFileByPath(filePath);

      if (!record) {
        entries.push({ filePath, status: 'new' });
        continue;
      }

      const localContent = file instanceof TFile
        ? await vault.read(file)
        : '';
      const localHash = await hashContent(localContent);

      let remoteVersion: number | undefined;
      let remoteHash: string | undefined;
      try {
        const remotePage = await client.getPage(record.pageId);
        remoteVersion = remotePage.version.number;
        remoteHash = await hashContent(remotePage.body.storage.value);
      } catch {
        entries.push({ filePath, status: 'new', record });
        continue;
      }

      const localChanged = localHash !== record.localHash;
      const remoteChanged = remoteHash !== record.remoteHash;

      let status: FileStatus;
      if (localChanged && remoteChanged) {
        status = 'conflicted';
      } else if (localChanged) {
        status = 'ahead';
      } else if (remoteChanged) {
        status = 'behind';
      } else {
        status = 'synced';
      }

      entries.push({ filePath, status, record, localHash, remoteVersion });
    }
  }

  return entries;
}

export async function resolveFiles(
  mapping: FileMapping,
  vault: Vault
): Promise<string[]> {
  const abstract = vault.getAbstractFileByPath(mapping.localPath);
  if (!abstract) return [];

  if (abstract instanceof TFile) return [abstract.path];

  // Folder
  const files: string[] = [];
  const recurse = (folderPath: string) => {
    for (const child of vault.getFiles()) {
      if (
        child.path.startsWith(folderPath + '/') &&
        child.extension === 'md'
      ) {
        if (
          mapping.recursive ||
          !child.path.slice(folderPath.length + 1).includes('/')
        ) {
          files.push(child.path);
        }
      }
    }
  };
  recurse(abstract.path);
  return files;
}
