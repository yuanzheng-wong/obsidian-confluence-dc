import { TFile, Vault } from 'obsidian';
import { ConfluenceClient } from '../api/client';
import { AttachmentRecord } from './state';

export interface LocalImage {
  ref: string;      // exact string from markdown (inside ![[...]] or src of ![](...)
  localPath: string;
  filename: string; // basename used on Confluence
}

// Returns all local image refs found in markdown, with their resolved vault paths
export function findLocalImages(markdown: string, vault: Vault, sourceFilePath: string): LocalImage[] {
  const images: LocalImage[] = [];
  const seenPaths = new Set<string>();

  const add = (ref: string) => {
    const clean = ref.split('|')[0].trim(); // strip wikilink aliases
    const file = resolveFile(clean, vault);
    if (!file || seenPaths.has(file.path)) return;
    if (!isImage(file.name)) return;
    seenPaths.add(file.path);
    images.push({ ref: clean, localPath: file.path, filename: file.name });
  };

  // ![[image.png]] or ![[path/image.png|alias]]
  for (const m of markdown.matchAll(/!\[\[([^\]]+)\]\]/g)) add(m[1]);

  // ![alt](src) where src is not a URL
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    if (!m[1].startsWith('http://') && !m[1].startsWith('https://')) add(m[1]);
  }

  return images;
}

// Map from markdown ref → Confluence filename, for use in md-to-storage
export function buildImageMap(images: LocalImage[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const img of images) map[img.ref] = img.filename;
  return map;
}

// Upload new/changed images to a Confluence page, return updated attachment records
export async function pushAttachments(
  pageId: string,
  images: LocalImage[],
  vault: Vault,
  client: ConfluenceClient,
  existing: Record<string, AttachmentRecord>,
  onProgress?: (msg: string) => void | Promise<void>
): Promise<Record<string, AttachmentRecord>> {
  const updated: Record<string, AttachmentRecord> = {};

  const total = images.length;
  for (let i = 0; i < total; i++) {
    const img = images[i];
    const file = vault.getAbstractFileByPath(img.localPath);
    if (!(file instanceof TFile)) continue;

    const arrayBuf = await vault.readBinary(file);
    const localHash = await hashBuffer(arrayBuf);
    const prev = existing[img.filename];

    if (prev && prev.localHash === localHash) {
      updated[img.filename] = prev;
      continue;
    }

    onProgress?.(`Uploading attachment ${i + 1}/${total}: ${img.filename}`);
    const mimeType = guessMime(img.filename);
    const att = await client.uploadAttachment(pageId, img.filename, Buffer.from(arrayBuf), mimeType);

    updated[img.filename] = {
      attachmentId: att.id,
      filename: img.filename,
      localPath: img.localPath,
      localHash,
      remoteVersion: att.version?.number ?? 1,
      mimeType,
    };
  }

  // Carry over records for attachments not in this push (e.g. images in other mapped files)
  for (const [name, rec] of Object.entries(existing)) {
    if (!updated[name]) updated[name] = rec;
  }

  return updated;
}

// Download new/changed attachments from Confluence to the vault attachments folder
export async function pullAttachments(
  pageId: string,
  vault: Vault,
  client: ConfluenceClient,
  attachmentsFolder: string,
  existing: Record<string, AttachmentRecord>
): Promise<Record<string, AttachmentRecord>> {
  const remoteList = await client.getAttachments(pageId);
  const updated: Record<string, AttachmentRecord> = { ...existing };

  for (const att of remoteList) {
    if (!isImage(att.title)) continue;

    const prev = existing[att.title];
    if (prev && prev.remoteVersion >= att.version.number) continue;

    const data = await client.downloadAttachment(att._links.download);
    const localPath = `${attachmentsFolder}/${att.title}`;

    await ensureFolder(vault, attachmentsFolder);

    const existingFile = vault.getAbstractFileByPath(localPath);
    if (existingFile instanceof TFile) {
      await vault.modifyBinary(existingFile, data.buffer as ArrayBuffer);
    } else {
      await vault.createBinary(localPath, data.buffer as ArrayBuffer);
    }

    const localHash = await hashBuffer(data.buffer as ArrayBuffer);
    updated[att.title] = {
      attachmentId: att.id,
      filename: att.title,
      localPath,
      localHash,
      remoteVersion: att.version.number,
      mimeType: att.metadata.mediaType,
    };
  }

  return updated;
}

function resolveFile(ref: string, vault: Vault): TFile | null {
  const direct = vault.getAbstractFileByPath(ref);
  if (direct instanceof TFile) return direct;
  const basename = ref.split('/').pop() ?? ref;
  return vault.getFiles().find(f => f.name === basename) ?? null;
}

function isImage(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(filename);
}

async function hashBuffer(buf: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function ensureFolder(vault: Vault, path: string): Promise<void> {
  if (vault.getAbstractFileByPath(path)) return;
  try { await vault.createFolder(path); } catch { /* already exists */ }
}
