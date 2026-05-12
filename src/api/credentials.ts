import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ConfluenceSettings } from '../settings';
import { decryptSecret } from './safeStorage';

let SESSION_FILE = '';

export function initCredentials(pluginDir: string): void {
  SESSION_FILE = join(pluginDir, '.bw_session');
}

// Snap binaries aren't always on Electron's PATH
const BW_CANDIDATES = ['/snap/bin/bw', '/usr/local/bin/bw', '/usr/bin/bw', 'bw'];

function bwBin(): string {
  for (const candidate of BW_CANDIDATES) {
    try {
      execSync(`"${candidate}" --version`, { stdio: 'pipe', timeout: 2000 });
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error('bw binary not found. Checked: ' + BW_CANDIDATES.join(', '));
}

const _bwBin = (() => {
  let resolved: string | null = null;
  return () => {
    if (!resolved) resolved = bwBin();
    return resolved;
  };
})();

export function readSession(): string {
  try {
    return readFileSync(SESSION_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

export function writeSession(session: string): void {
  writeFileSync(SESSION_FILE, session + '\n', { mode: 0o600 });
}

export function unlockBw(masterPassword: string): string {
  const bin = _bwBin();
  let output: string;
  try {
    output = execSync(`"${bin}" unlock --raw`, {
      encoding: 'utf8',
      timeout: 10000,
      input: masterPassword + '\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(err.stderr?.trim() || err.message || String(e));
  }
  if (!output) throw new Error('bw unlock returned empty session key');
  writeSession(output);
  return output;
}

function bwExec(args: string, session: string): string {
  const bin = _bwBin();
  try {
    return execSync(`"${bin}" ${args}`, {
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, BW_SESSION: session },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    throw new Error(err.stderr?.trim() || err.stdout?.trim() || err.message || String(e));
  }
}

function bwGetItem(itemName: string, session: string): unknown {
  // List and exact-match by name to avoid substring collision
  const listJson = bwExec(`list items --search ${JSON.stringify(itemName)}`, session);
  let items: Array<{ id: string; name: string }>;
  try {
    items = JSON.parse(listJson);
  } catch {
    throw new Error(`bw list returned non-JSON: ${listJson.slice(0, 200)}`);
  }

  const exact = items.filter((i) => i.name === itemName);
  if (exact.length === 0) throw new Error(`No Bitwarden item named exactly "${itemName}"`);
  if (exact.length > 1) throw new Error(`Multiple Bitwarden items named "${itemName}" — rename one to make it unique`);

  const itemJson = bwExec(`get item ${exact[0].id}`, session);
  try {
    return JSON.parse(itemJson);
  } catch {
    throw new Error(`bw get item returned non-JSON: ${itemJson.slice(0, 200)}`);
  }
}

export function resolveAuthHeader(settings: ConfluenceSettings): string {
  if (settings.credentialSource === 'bitwarden') {
    const session = readSession();
    if (!session) {
      throw new Error(
        'Bitwarden is locked. Use the "Unlock Bitwarden" button in plugin settings.'
      );
    }

    let item: { login?: { username?: string; password?: string } };
    try {
      item = bwGetItem(settings.bitwardenItem, session) as typeof item;
    } catch (e) {
      throw new Error(
        `Bitwarden lookup failed for "${settings.bitwardenItem}": ${(e as Error).message}. ` +
        `Try unlocking again from plugin settings.`
      );
    }

    if (settings.authType === 'pat') {
      const pat = item.login?.password;
      if (!pat) throw new Error(`Bitwarden item "${settings.bitwardenItem}" has no password field (store your PAT there)`);
      return `Bearer ${pat}`;
    } else {
      const { username, password } = item.login ?? {};
      if (!username || !password) throw new Error(`Bitwarden item "${settings.bitwardenItem}" is missing username or password`);
      return `Basic ${btoa(`${username}:${password}`)}`;
    }
  }

  if (settings.authType === 'pat') return `Bearer ${decryptSecret(settings.pat)}`;
  return `Basic ${btoa(`${settings.username}:${decryptSecret(settings.password)}`)}`;
}
