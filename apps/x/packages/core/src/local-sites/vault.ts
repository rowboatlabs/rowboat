import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkDir } from '../config/config.js';

// --- Vault folder configuration ---
// Each vault folder maps a short alias to a physical directory on disk.
// Files are served via /vault/<alias>/<relative-path>.

export interface VaultFolder {
  alias: string;
  path: string;           // ~ and env vars expanded at load time
  default?: boolean;      // the workspace folder is always present
}

export interface VaultConfig {
  folders: VaultFolder[];
}

const VAULT_CONFIG_PATH = path.join(WorkDir, 'config', 'vault.json');

function expandPath(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

function detectDefaultFolders(): VaultFolder[] {
  const folders: VaultFolder[] = [
    { alias: 'workspace', path: WorkDir, default: true },
  ];

  const candidates: Array<{ alias: string; dir: string }> = [
    { alias: 'downloads', dir: path.join(os.homedir(), 'Downloads') },
    { alias: 'desktop', dir: path.join(os.homedir(), 'Desktop') },
    { alias: 'documents', dir: path.join(os.homedir(), 'Documents') },
  ];

  for (const { alias, dir } of candidates) {
    try {
      if (fs.statSync(dir).isDirectory()) {
        folders.push({ alias, path: dir });
      }
    } catch {
      // Directory doesn't exist, skip it
    }
  }

  return folders;
}

export function loadVaultConfig(): VaultConfig {
  try {
    const raw = fs.readFileSync(VAULT_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as VaultConfig;

    // Expand paths
    for (const folder of parsed.folders) {
      folder.path = expandPath(folder.path);
    }

    // Ensure workspace is always present
    if (!parsed.folders.some(f => f.alias === 'workspace')) {
      parsed.folders.unshift({ alias: 'workspace', path: WorkDir, default: true });
    }

    return parsed;
  } catch {
    return { folders: detectDefaultFolders() };
  }
}

export function saveVaultConfig(config: VaultConfig): void {
  const dir = path.dirname(VAULT_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Store paths in compact form (use ~/ for home-relative paths)
  const serializable = {
    folders: config.folders.map(f => ({
      ...f,
      path: f.path.startsWith(os.homedir())
        ? '~' + f.path.slice(os.homedir().length)
        : f.path,
    })),
  };

  fs.writeFileSync(VAULT_CONFIG_PATH, JSON.stringify(serializable, null, 2));
}

export function ensureVaultConfig(): void {
  if (fs.existsSync(VAULT_CONFIG_PATH)) return;
  const config = { folders: detectDefaultFolders() };
  saveVaultConfig(config);
}

/** Resolve a vault alias + relative path to an absolute file path.
 *  Returns null if the alias doesn't exist or the path traverses outside the folder. */
export function resolveVaultPath(alias: string, relPath: string, config: VaultConfig): string | null {
  const folder = config.folders.find(f => f.alias === alias);
  if (!folder) return null;

  const absPath = path.resolve(folder.path, relPath);
  // Path traversal check
  if (!absPath.startsWith(folder.path + path.sep) && absPath !== folder.path) return null;

  return absPath;
}

/** Given an absolute path, find the vault alias + relative path.
 *  Returns null if the path doesn't fall inside any vault folder. */
export function findVaultAlias(absPath: string, config: VaultConfig): { alias: string; relPath: string } | null {
  // Sort folders by path length descending so more specific matches win
  const sorted = [...config.folders].sort((a, b) => b.path.length - a.path.length);

  for (const folder of sorted) {
    if (absPath.startsWith(folder.path + path.sep) || absPath === folder.path) {
      const relPath = path.relative(folder.path, absPath);
      return { alias: folder.alias, relPath };
    }
  }

  return null;
}

/** Given an arbitrary file path (may be relative, ~, or absolute),
 *  resolve it to a vault URL path like /vault/<alias>/<relPath>.
 *  Returns null if the path doesn't fall inside any vault folder. */
export function filePathToVaultUrl(filePath: string, config: VaultConfig): string | null {
  const expanded = expandPath(filePath);

  // Check if it's a workspace-relative path (e.g. "knowledge/notes.md")
  if (!filePath.startsWith('/') && !filePath.startsWith('~') && !filePath.includes(':')) {
    const absPath = path.resolve(WorkDir, filePath);
    const match = findVaultAlias(absPath, config);
    if (match) return `/vault/${match.alias}/${match.relPath}`;
  }

  const match = findVaultAlias(expanded, config);
  if (match) return `/vault/${match.alias}/${match.relPath}`;

  return null;
}
