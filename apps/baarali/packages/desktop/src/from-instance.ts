// What the agent makes on the instance, shown on the computer (05/10/2026).
// An image the agent generated is saved in the instance's workspace
// (core generated_images/), and the chat shows it by reading its path on
// this computer (shell:readFileBase64), where it is not: the founder would
// have got a file card that opens nothing. In remote mode, a path that is
// not here but lies in the instance's workspace is read there instead.
// Copied into the desktop main process by scripts/brand.mjs.

/** The same ceiling as the computer's own read (main ipc.ts). */
export const MAX_BYTES = 10 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
  '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown',
};

export const mimeOf = (p: string): string => {
  const dot = p.lastIndexOf('.');
  return (dot >= 0 && MIME[p.slice(dot).toLowerCase()]) || 'application/octet-stream';
};

export interface FromInstanceDeps {
  remote: () => boolean;
  /** Whether the path exists on this computer. */
  existsHere: (abs: string) => Promise<boolean>;
  /** The instance's workspace root, an absolute path there. */
  root: () => Promise<string>;
  /** Reads a workspace path of the instance, in base64. */
  read: (rel: string) => Promise<{ data: string; size: number }>;
}

export interface FromInstanceResult {
  data: string;
  mimeType: string;
  size: number;
}

/**
 * The file read on the instance, or null to read it on this computer as
 * before: not in remote mode, a path that exists here, or one outside the
 * instance's workspace.
 */
export function createFromInstance(deps: FromInstanceDeps) {
  return async (abs: string): Promise<FromInstanceResult | null> => {
    if (!deps.remote() || !abs.startsWith('/') || (await deps.existsHere(abs))) return null;
    const root = (await deps.root()).replace(/\/+$/, '');
    if (!abs.startsWith(root + '/')) return null;
    const rel = abs.slice(root.length + 1);
    // The workspace refuses these too; refused here, nothing is asked of it.
    if (!rel || rel.split('/').includes('..')) return null;
    const { data, size } = await deps.read(rel);
    if (size > MAX_BYTES) throw new Error('File too large (>10MB)');
    return { data, mimeType: mimeOf(rel), size };
  };
}
