interface SafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

function getSafeStorage(): SafeStorageApi | null {
  try {
    // electron is external — resolved by Obsidian's renderer at runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { remote?: { safeStorage?: SafeStorageApi } };
    const ss = electron.remote?.safeStorage;
    if (ss?.isEncryptionAvailable()) return ss;
  } catch { /* unavailable in this environment */ }
  return null;
}

const PREFIX = 'enc1:';

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const ss = getSafeStorage();
  if (!ss) return plaintext;
  return PREFIX + ss.encryptString(plaintext).toString('base64');
}

/** Decrypts a value produced by encryptSecret. Passes through plaintext transparently. */
export function decryptSecret(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  const ss = getSafeStorage();
  if (!ss) return stored;
  return ss.decryptString(Buffer.from(stored.slice(PREFIX.length), 'base64'));
}
