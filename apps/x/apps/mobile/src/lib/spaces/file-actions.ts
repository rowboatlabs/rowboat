import type { Asset, Attribution, ChangeSet } from '@rowboat/spaces-protocol';

import type { SpacesClient } from './client';

// The contract's canonical file link (https://<org>/s/<space>/a/<id>); in a
// message it reads as the file's name. The actions on it live in
// components/file-action-sheet.tsx.
export function fileLink(org: string, space: string, assetId: string): string {
  return `https://${org}/s/${space}/a/${encodeURIComponent(assetId)}`;
}

export function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** The folder a path sits in, '' at the top level. */
export function parentFolder(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

export function joinPath(folder: string, name: string): string {
  const clean = folder.trim().replace(/^\/+|\/+$/g, '');
  return clean ? `${clean}/${name}` : name;
}

/** Every folder the listing implies (folders are path prefixes, 2026-09-14), sorted. */
export function folderPaths(entries: Pick<Asset, 'path'>[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Live files inside a folder, at any depth. */
export function filesInFolder<T extends Pick<Asset, 'path' | 'state'>>(entries: T[], folder: string): T[] {
  return entries.filter((e) => e.state !== 'deleted' && e.path.startsWith(`${folder}/`));
}

// A history row offers going back when it is a content edit older than the
// head (2026-11-13, the desktop's rule in lib/spaces-presentation.ts): moves,
// deletes and restores carry no content of their own.
export function isRestorableChangeSet(cs: ChangeSet, currentVersion: number): boolean {
  return !cs.op && cs.resultVersion < currentVersion;
}

/** "Ana", or "Ana (via Rowboat)" for an agent acting for her — the desktop's label. */
export function attributionLabel(a: Attribution, names: Map<string, string>): string {
  const name = names.get(a.memberId) ?? a.memberId;
  if (a.actingMode === 'direct') return name;
  const agent = a.agentName ?? 'agent';
  return a.actingMode === 'scheduled' ? `${name} (via ${agent}, scheduled)` : `${name} (via ${agent})`;
}

/**
 * Bring a file back to an older version (2026-11-13, the desktop's
 * RestoreVersionDialog). Going back is an ordinary change, not a rewind: the
 * old content is proposed against a freshly read head, so every version in
 * between stays in history. A binary version re-references its blob.
 */
export async function restoreVersion(client: SpacesClient, space: string, assetId: string, version: number) {
  const head = await client.readAsset(space, assetId);
  const snapshot = await client.readAsset(space, assetId, version);
  return client.proposeChange(space, {
    assetId,
    baseVersion: head.version,
    ...(snapshot.blob ? { blob: snapshot.blob.hash } : { newContent: snapshot.content }),
    reason: `restore to v${version}`,
    actingMode: 'direct',
  });
}

/**
 * Move every file in a folder under a new folder path (2026-11-13). Folders
 * are only path prefixes, so renaming one is one move per file. Each file
 * moves at the version the listing showed; a file that changed meanwhile, or
 * whose new path is taken, stays where it was and is counted as failed.
 */
export async function moveFolder(client: SpacesClient, space: string, entries: Asset[], from: string, to: string) {
  let moved = 0;
  let failed = 0;
  for (const e of filesInFolder(entries, from)) {
    try {
      const res = await client.moveAsset(space, { assetId: e.id, toPath: `${to}${e.path.slice(from.length)}`, baseVersion: e.version, actingMode: 'direct' });
      if (res.outcome === 'moved') moved++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { moved, failed };
}

/** Every file in a folder to Trash, each at the version the listing showed (same counting as moveFolder). */
export async function trashFolder(client: SpacesClient, space: string, entries: Asset[], folder: string) {
  let deleted = 0;
  let failed = 0;
  for (const e of filesInFolder(entries, folder)) {
    try {
      const res = await client.deleteAsset(space, { assetId: e.id, baseVersion: e.version, actingMode: 'direct' });
      if (res.outcome === 'deleted') deleted++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

/** "notes (1).md", "notes (2).md"… — the first numbered name nobody holds. */
export function availableCopyPath(path: string, occupied: ReadonlySet<string>): string {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const split = dot > slash + 1 ? dot : path.length;
  const stem = path.slice(0, split);
  const extension = path.slice(split);
  for (let n = 1; ; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!occupied.has(candidate)) return candidate;
  }
}

export type UploadChoice = 'keep' | 'replace' | 'cancel';
/** A live file already at the wanted path; `changed` = it changed while saving. */
export interface UploadClash {
  path: string;
  changed: boolean;
}

/**
 * Save an upload at a path, asking when a live file already holds it
 * (2026-11-13, the desktop's useSpaceFileSave in file-conflict.tsx). Keep both
 * saves a numbered copy; Replace saves a new version of the existing file, at
 * the version the person approved, so its history stays. A write that lands
 * in between asks again. Returns the saved file, or null when cancelled.
 */
export async function saveUpload(
  client: SpacesClient,
  space: string,
  { path, reason, getBlob, ask }: { path: string; reason: string; getBlob: () => Promise<string>; ask: (clash: UploadClash) => Promise<UploadChoice> },
): Promise<{ assetId: string; path: string } | null> {
  const list = async () => await client.listAssets(space);
  const entries = await list();
  const occupied = new Set(entries.map((e) => e.path));
  const existing = entries.find((e) => e.path === path);
  let clash: { path: string; assetId: string; version: number; changed: boolean } | null = existing
    ? { path, assetId: existing.id, version: existing.version, changed: false }
    : null;
  let destination = path;
  let replace: { assetId: string; baseVersion: number } | null = null;
  let hash: string | undefined;
  for (;;) {
    if (clash) {
      const choice = await ask({ path: clash.path, changed: clash.changed });
      if (choice === 'cancel') return null;
      if (choice === 'replace') {
        replace = { assetId: clash.assetId, baseVersion: clash.version };
      } else {
        occupied.add(clash.path);
        for (const e of await list()) occupied.add(e.path);
        destination = availableCopyPath(path, occupied);
        replace = null;
      }
    }
    hash ??= await getBlob();
    if (replace) {
      const result = await client.proposeChange(space, { assetId: replace.assetId, baseVersion: replace.baseVersion, blob: hash, reason, actingMode: 'direct' });
      if (result.outcome !== 'conflict') return { assetId: replace.assetId, path: destination };
      clash = { path: destination, assetId: replace.assetId, version: result.currentVersion, changed: true };
      continue;
    }
    try {
      const created = await client.createAsset(space, { path: destination, blob: hash, reason, actingMode: 'direct' });
      return { assetId: created.asset.id, path: created.asset.path };
    } catch (err) {
      // The server refuses an occupied path: if someone landed a file there
      // since the check, that is a clash to decide on, not a failure.
      const occupant = (await list().catch(() => [] as Asset[])).find((e) => e.path === destination);
      if (!occupant) throw err;
      clash = { path: destination, assetId: occupant.id, version: occupant.version, changed: true };
    }
  }
}
