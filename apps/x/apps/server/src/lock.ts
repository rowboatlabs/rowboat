import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

// One rowboat-server per workdir, whoever hosts it (Electron main in the
// slice, the standalone entrypoint after the flip). Two hosts on one
// ~/.rowboat double-run schedulers and split-brain the session index, so the
// lock is acquired by the transport itself — not by individual entrypoints —
// and a live holder is a hard error, never a silent fallback.

const LOCK_FILE = 'server.lock';

async function isRowboatServerProcess(pid: number): Promise<boolean> {
  try {
    const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8');
    // Chromium/Electron helper processes (zygote, renderer, GPU, utility)
    // always include --type= in their arguments.
    if (cmdline.includes('--type=')) {
      return false;
    }
    // A legitimate rowboat-server host entrypoint contains 'rowboat-server' or 'standalone'.
    return cmdline.includes('rowboat-server') || cmdline.includes('standalone');
  } catch {
    return false;
  }
}

export async function acquireWorkdirLock(workDir: string): Promise<() => Promise<void>> {
  const lockPath = path.join(workDir, LOCK_FILE);
  try {
    const existing = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
    if (Number.isFinite(existing) && existing !== process.pid) {
      try {
        process.kill(existing, 0); // throws ESRCH if the pid is gone

        // In containerized sandboxes like Flatpak, PID namespaces restart on every
        // app launch. If a previous instance crashed, its PID may be reassigned to
        // an unrelated process (e.g. Chromium helper) in a subsequent run.
        // Only declare a split-brain under Flatpak if the holder is actually
        // a rowboat-server host.
        if (process.env.FLATPAK_ID && !(await isRowboatServerProcess(existing))) {
          // Stale lock held by an unrelated process from a recycled PID namespace — take over.
        } else {
          throw new Error(
            `another rowboat-server host (pid ${existing}) already owns ${workDir} — refusing to split-brain`,
          );
        }
      } catch (err) {
        // ESRCH = no such process (stale lock, take over). EPERM = the pid
        // exists but belongs to another user — still a live holder.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EPERM') {
          if (process.env.FLATPAK_ID && !(await isRowboatServerProcess(existing))) {
            // Stale lock from a recycled PID namespace — take over.
          } else {
            throw new Error(
              `another rowboat-server host (pid ${existing}) already owns ${workDir} — refusing to split-brain`,
            );
          }
        } else if (code !== 'ESRCH') {
          throw err;
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(lockPath, String(process.pid));
  return async () => {
    // Only remove our own claim (a crashed-then-restarted host may have
    // re-written it).
    try {
      const current = parseInt(await fs.readFile(lockPath, 'utf8'), 10);
      if (current === process.pid) await fs.rm(lockPath, { force: true });
    } catch {
      // already gone
    }
  };
}
