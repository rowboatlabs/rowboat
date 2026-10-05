// Files and folders of the computer, sent to the account's instance
// (05/10/2026: adding a folder to Projets failed in the cloud).
//
// Joined to its instance, the app's core runs there: a folder picked on the
// computer (a project, a work directory) or a file attached to a message is a
// path the instance does not have. Before such a path is handed over, it is
// copied into the instance's workspace, and the copy's path is used instead:
// Projects/<name> for a folder, Attachments/<day>/<name> for a file. On its
// own core (not joined), the app reads the computer itself: paths are kept.
//
// What a folder holds is read here, on the computer: the folders that are
// rebuilt rather than kept (node_modules, build outputs, caches) are left out,
// links are not followed (only what is really in the folder leaves it), and a
// folder too big for the instance's disk is refused whole, before anything is
// sent. No upstream file changes: the Baarali build copies this file into
// main and routes `files:toInstance` to it (scripts/brand.mjs).

/** Rebuilt by their tools, never worth the instance's disk. */
export const SKIPPED_DIRS = new Set([
  'node_modules', 'bower_components', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', '.gradle', 'Pods', 'DerivedData', 'target',
]);
const SKIPPED_FILES = new Set(['.DS_Store', 'Thumbs.db']);

export const LIMITS = { files: 3000, bytes: 100 * 1024 * 1024, fileBytes: 25 * 1024 * 1024 };

export type Into = 'projects' | 'attachments';

export interface Entry {
  name: string;
  kind: 'file' | 'dir' | 'other';
}

export interface ToInstanceDeps {
  /** Whether the app is joined to its instance. */
  remote: () => boolean;
  /** On the computer. */
  stat: (abs: string) => Promise<{ kind: 'file' | 'dir' | 'other'; size: number }>;
  readdir: (abs: string) => Promise<Entry[]>;
  /** The file's bytes, as base64. */
  readFile: (abs: string) => Promise<string>;
  /** On the instance, relative to its workspace. */
  exists: (rel: string) => Promise<boolean>;
  write: (rel: string, base64: string) => Promise<void>;
  root: () => Promise<string>;
  now: () => number;
  /** Uploads at once. */
  parallel?: number;
}

export interface ToInstanceResult {
  /** The paths to hand over, in the order given. */
  paths: string[];
  /** Files left out because they are too big (their path on the computer). */
  skipped: string[];
}

/** Thrown when a folder is too big: its message is for the person. */
export class TooBigError extends Error {}

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Folder';
const join = (...parts: string[]): string => parts.filter(Boolean).join('/');

/** A name the instance's workspace accepts: no separators, no « .. » (workspace.ts assertSafeRelPath). */
export function safeName(name: string): string {
  const cleaned = name.replace(/[\\/]/g, '-').replace(/\.{2,}/g, '.').trim();
  return cleaned && cleaned !== '.' ? cleaned : 'file';
}

/** « name », else « name 2 », « name 3 »… before the extension of a file. */
export async function freeName(dir: string, name: string, isFile: boolean, exists: (rel: string) => Promise<boolean>): Promise<string> {
  const dot = isFile ? name.lastIndexOf('.') : -1;
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    if (!(await exists(join(dir, candidate)))) return candidate;
  }
  throw new Error(`No free name for ${name}`);
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const megabytes = (bytes: number): string => `${Math.ceil(bytes / (1024 * 1024))} MB`;

interface Planned {
  abs: string;
  rel: string;
  size: number;
}

/** What a folder sends: its files, relative to it, within the limits. */
export async function planFolder(abs: string, deps: Pick<ToInstanceDeps, 'readdir' | 'stat'>): Promise<{ files: Planned[]; skipped: string[] }> {
  const files: Planned[] = [];
  const skipped: string[] = [];
  let bytes = 0;
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await deps.readdir(dir)) {
      const from = `${dir}/${entry.name}`;
      const to = join(rel, safeName(entry.name));
      if (entry.kind === 'dir') {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(from, to);
        continue;
      }
      // Links and anything else that is not a plain file stay on the computer.
      if (entry.kind !== 'file' || SKIPPED_FILES.has(entry.name)) continue;
      const { size } = await deps.stat(from);
      if (size > LIMITS.fileBytes) {
        skipped.push(from);
        continue;
      }
      files.push({ abs: from, rel: to, size });
      bytes += size;
      if (files.length > LIMITS.files || bytes > LIMITS.bytes) {
        throw new TooBigError(
          `This folder is too big to send to your Baarali space: more than ${LIMITS.files} files or ${megabytes(LIMITS.bytes)}. Choose a smaller folder.`,
        );
      }
    }
  };
  await walk(abs, '');
  return { files, skipped };
}

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/** The opener of `files:toInstance`: copies on the instance, else keeps the paths. */
export function createToInstance(deps: ToInstanceDeps): (args: { paths: string[]; into: Into }) => Promise<ToInstanceResult> {
  return async ({ paths, into }) => {
    if (!deps.remote() || paths.length === 0) return { paths, skipped: [] };
    const root = (await deps.root()).replace(/\/+$/, '');
    const parent = into === 'projects' ? 'Projects' : join('Attachments', day(deps.now()));
    const out: string[] = [];
    const skipped: string[] = [];
    for (const abs of paths) {
      const { kind, size } = await deps.stat(abs);
      if (kind === 'dir') {
        // Read whole before anything is sent: a refused folder leaves nothing behind.
        const plan = await planFolder(abs, deps);
        const name = await freeName(parent, safeName(baseName(abs)), false, deps.exists);
        const dir = join(parent, name);
        skipped.push(...plan.skipped);
        await inBatches(plan.files, deps.parallel ?? 4, async (f) => deps.write(join(dir, f.rel), await deps.readFile(f.abs)));
        // An empty folder still exists on the instance.
        if (plan.files.length === 0) await deps.write(join(dir, '.keep'), '');
        out.push(`${root}/${dir}`);
      } else if (kind === 'file') {
        if (size > LIMITS.fileBytes) {
          throw new TooBigError(`This file is too big to send to your Baarali space (${megabytes(LIMITS.fileBytes)} at most).`);
        }
        const name = await freeName(parent, safeName(baseName(abs)), true, deps.exists);
        await deps.write(join(parent, name), await deps.readFile(abs));
        out.push(`${root}/${join(parent, name)}`);
      } else {
        throw new Error(`Not a file or a folder: ${baseName(abs)}`);
      }
    }
    return { paths: out, skipped };
  };
}
