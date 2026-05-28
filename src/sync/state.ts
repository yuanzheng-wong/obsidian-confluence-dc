import { Plugin } from 'obsidian';

export interface AttachmentRecord {
  attachmentId: string;
  filename: string;       // name on Confluence
  localPath: string;      // vault-relative path
  localHash: string;      // hash of local file at last sync
  remoteVersion: number;  // Confluence attachment version at last sync
  mimeType: string;
  mermaidSource?: string; // set for mermaid-diagram-N.svg attachments; used on pull to reconstruct code block
}

export interface FileSyncRecord {
  pageId: string;
  pageVersion: number;
  localHash: string;
  remoteHash: string;
  lastSynced: string;
  spaceKey: string;
  pageTitle: string;
  pageUrl: string;
  attachments: Record<string, AttachmentRecord>; // keyed by filename
}

interface SyncData {
  files: Record<string, FileSyncRecord>;
}

const STATE_FILE = 'sync-state.json';

export async function hashContent(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const buf = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class StateManager {
  private data: SyncData = { files: {} };
  private statePath: string;

  constructor(private plugin: Plugin) {
    this.statePath = `${plugin.manifest.dir}/${STATE_FILE}`;
  }

  async load(): Promise<void> {
    try {
      const raw = await this.plugin.app.vault.adapter.read(this.statePath);
      const parsed = JSON.parse(raw) as Partial<SyncData>;
      this.data = { files: parsed?.files ?? {} };
    } catch {
      this.data = { files: {} };
    }
  }

  async save(): Promise<void> {
    await this.plugin.app.vault.adapter.write(
      this.statePath,
      JSON.stringify(this.data, null, 2)
    );
  }

  get(filePath: string): FileSyncRecord | undefined {
    return this.data.files[filePath];
  }

  async set(filePath: string, record: FileSyncRecord): Promise<void> {
    this.data.files[filePath] = record;
    await this.save();
  }

  async remove(filePath: string): Promise<void> {
    delete this.data.files[filePath];
    await this.save();
  }

  all(): Record<string, FileSyncRecord> {
    return { ...this.data.files };
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const record = this.data.files[oldPath];
    if (record) {
      this.data.files[newPath] = record;
      delete this.data.files[oldPath];
      await this.save();
    }
  }
}
