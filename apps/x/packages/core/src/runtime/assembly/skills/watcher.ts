import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import { SKILL_ROOTS } from "./disk-loader.js";
import { refreshDiskSkills } from "./index.js";
import { invalidateCopilotInstructionsCache } from "../copilot/instructions.js";

// The skills CLI writes many files per install (~13 paths for one skill), so we
// coalesce a burst of events into a single refresh.
const DEBOUNCE_MS = 400;

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

function scheduleReload(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      const count = refreshDiskSkills();
      invalidateCopilotInstructionsCache();
      console.log(`[disk-skills] reloaded ${count} skills after change`);
    } catch (err) {
      // A bad SKILL.md (or any refresh error) must never crash the app.
      console.error("[disk-skills] failed to reload after change:", err);
    }
  }, DEBOUNCE_MS);
}

/**
 * Start watching the disk skill roots (~/.rowboat/skills, ~/.agents/skills) for
 * changes and live-reload the skill catalog. Idempotent. Missing directories
 * are skipped so watching ~/.agents when it doesn't exist never errors.
 */
export function startSkillsWatcher(): void {
  if (watcher) return;

  const roots = SKILL_ROOTS.filter((root) => {
    try {
      return fs.statSync(root).isDirectory();
    } catch {
      return false; // Directory absent (e.g. ~/.agents/skills) — nothing to watch.
    }
  });

  if (roots.length === 0) {
    console.log("[disk-skills] no skill directories present; watcher idle");
    return;
  }

  try {
    watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    // Any add/change/unlink (files or dirs) under a root triggers a debounced reload.
    watcher
      .on("add", scheduleReload)
      .on("change", scheduleReload)
      .on("unlink", scheduleReload)
      .on("addDir", scheduleReload)
      .on("unlinkDir", scheduleReload)
      .on("error", (error: unknown) => {
        console.error("[disk-skills] watcher error:", error);
      });

    console.log(`[disk-skills] watching ${roots.length} skill director${roots.length === 1 ? "y" : "ies"} for changes`);
  } catch (err) {
    console.error("[disk-skills] failed to start watcher:", err);
    watcher = null;
  }
}

/** Stop the skills watcher and clear any pending reload. Idempotent. */
export function stopSkillsWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close().catch(() => { /* ignore close errors on shutdown */ });
    watcher = null;
  }
}
