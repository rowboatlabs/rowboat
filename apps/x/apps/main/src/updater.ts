import { app, autoUpdater, net, nativeImage, BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { capture } from "@x/core/dist/analytics/posthog.js";
import { isVersionUpgrade } from "@x/core/dist/config/app_version.js";
import type { ipc } from "@x/shared";

export type UpdaterStatus = ipc.IPCChannels["updater:status"]["req"];

const REPO = "rowboatlabs/rowboat";
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const STALE_VERSION_SWEEP_DELAY_MS = 30 * 1000;

let status: UpdaterStatus = { state: "disabled", version: "", reason: "dev" };

function setStatus(next: Omit<UpdaterStatus, "version">): void {
  status = { version: status.version, ...next };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win.webContents) {
      win.webContents.send("updater:status", status);
    }
  }
}

export function getUpdaterStatus(): UpdaterStatus {
  return status;
}

// 32x32 green dot with a white ring (scratchpad-generated PNG). Windows'
// counterpart of the macOS dock badge: overlays the taskbar icon while an
// update is staged. Cleared implicitly — installing quits the process.
const WIN_BADGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABPUlEQVR42s1XOwoCMRC12CvkAhb2HmMvYS/kCgveQU9gYS17AKu1EKwXsdDCwtQWtk9GkiUbkv2RkAw8WLLJzEvmk8kMwCwmpixiAHIAHEAhweUYC0Ugk0Yq9Esl52a+CJAygfEi5NrJBOg4S5vm6+eOgzhh+zr+Qd805pCyyzUu4wsAta7l+X1j89hjeVljfl5ZQf9oDs01pJY6BxFgpnHapcuoC7TGQoINIdA6dn7bjTauQGst7ugkwH0Z7yDBXQQyPdqnHPtAdwg9Ra27pyDyZVzBCExuI9AUGYpk3wRIp1GsWgSY/rcr1aaCdBrCdAK5XmR8G1cwilWuE2j8T1UtFAHSbcaBIlCEiP6ebCiSIhDdBdGDMHoaRi9ESZTi6JdR9Os4iYYkiZYselOaRFuexMMkmadZEo/TYPgB7Se8LkyPD5UAAAAASUVORK5CYII=";

function showReadyBadge(): void {
  if (process.platform === "darwin") {
    // The window may be closed for days on macOS (app keeps running) — the
    // dock badge is the only surface that says "an update is waiting".
    app.dock?.setBadge("1");
  } else if (process.platform === "win32") {
    const badge = nativeImage.createFromDataURL(WIN_BADGE_DATA_URL);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.setOverlayIcon(badge, "Update ready — restart to install");
    }
  }
}

/**
 * Initialize auto-update, driving Electron's autoUpdater (Squirrel) against
 * update.electronjs.org directly. Events are forwarded to the renderer
 * (updater:status), which shows a "Restart to update" card once the update
 * is staged. By then Squirrel has already installed it — the card only asks
 * for the restart, Chrome-style. Must be called after app ready (it is —
 * from whenReady() in main.ts).
 */
export function initUpdater(): void {
  const version = app.getVersion();

  if (!app.isPackaged) {
    status = { state: "disabled", version, reason: "dev" };
    return;
  }
  if (process.platform === "linux") {
    // Electron's autoUpdater doesn't support Linux (deb/zip installs).
    status = { state: "unsupported", version, reason: "platform" };
    return;
  }
  if (process.platform === "darwin" && !app.isInApplicationsFolder()) {
    // Squirrel.Mac swaps the .app bundle in place, which fails outside
    // /Applications (DMG mount, ~/Downloads). Don't wire the updater —
    // Settings > Help tells the user to move the app.
    status = { state: "unsupported", version, reason: "not-in-applications" };
    return;
  }

  status = { state: "idle", version };

  if (process.platform === "win32") {
    // Squirrel.Windows is supposed to drop versions older than the previous
    // one on update, but that cleanup rarely runs (#792) and app-* folders
    // pile up — a full app copy per update. Sweep them ourselves once boot
    // has settled; the delay also gives a just-replaced version time to
    // release its file locks after quitAndInstall relaunched us.
    setTimeout(() => void sweepStaleSquirrelVersions(version), STALE_VERSION_SWEEP_DELAY_MS);
  }

  autoUpdater.on("checking-for-update", () => {
    setStatus({ state: "checking", lastCheckedAt: status.lastCheckedAt });
  });
  autoUpdater.on("update-available", () => {
    setStatus({ state: "downloading" });
  });
  autoUpdater.on("update-not-available", () => {
    setStatus({ state: "idle", lastCheckedAt: Date.now() });
  });
  autoUpdater.on("update-downloaded", (_event, releaseNotes, releaseName) => {
    // macOS (Squirrel.Mac fed by update.electronjs.org) supplies both the
    // release name and the GitHub release body; Squirrel.Windows only the
    // name. When notes are missing the card shows a static fallback line.
    setStatus({
      state: "ready",
      newVersion: releaseName || undefined,
      releaseNotes: releaseNotes || undefined,
    });
    showReadyBadge();
    // Squirrel.Windows never carries notes, and Squirrel.Mac's copy is a
    // snapshot from download time — stale when the release body is edited
    // after publish (update.electronjs.org caching widens that window).
    // Refresh from the GitHub API; on failure the snapshot (or the card's
    // static fallback line) stands.
    void backfillReleaseNotes(releaseName || undefined);
  });
  autoUpdater.on("error", (err) => {
    setStatus({ state: "error", error: err.message, lastCheckedAt: status.lastCheckedAt });
    capture("update_failed", { message: err.message });
  });

  // update.electronjs.org serves both Squirrel dialects from one URL:
  // Squirrel.Mac GETs it as-is (204 = up to date, JSON = update; that legacy
  // format is serverType "default"), Squirrel.Windows appends /RELEASES.
  autoUpdater.setFeedURL({
    url: `https://update.electronjs.org/${REPO}/${process.platform}-${process.arch}/${version}`,
    serverType: "default",
  });
  // Check now and every 10 minutes, through the same guard as the manual
  // check: a tick is a no-op while a check/download is in flight or an
  // update is already staged.
  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}

/**
 * Replace the staged update's release notes with the current GitHub release
 * body. releaseName is "0.7.7" from Squirrel.Windows and "v0.7.7" from
 * Squirrel.Mac — normalize to the tag form.
 */
async function backfillReleaseNotes(releaseName: string | undefined): Promise<void> {
  if (!releaseName) return;
  try {
    const tag = `v${releaseName.replace(/^v/, "")}`;
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/tags/${tag}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Rowboat" },
    });
    if (!res.ok) return;
    const { body } = (await res.json()) as { body?: string };
    const notes = body?.trim();
    // Re-check the state: the fetch raced user actions (quitAndInstall).
    if (notes && status.state === "ready" && status.newVersion === releaseName) {
      setStatus({ ...status, releaseNotes: notes });
    }
  } catch {
    // Offline or rate-limited — the Squirrel snapshot / fallback line stands.
  }
}

/**
 * Remove leftovers of older versions from the Squirrel.Windows install root
 * (#792). Everything strictly older than the running version goes: sibling
 * app-<version> folders and their .nupkg files under packages/. The running
 * version stays (its full .nupkg is what delta updates apply against), and
 * so does anything newer — that's an update staged while we run. Entries
 * that stay locked are skipped; the next launch retries them.
 */
async function sweepStaleSquirrelVersions(current: string): Promise<void> {
  const appDir = path.dirname(process.execPath); // <root>\app-<version>\rowboat.exe
  const rootDir = path.dirname(appDir);
  const ownDir = path.basename(appDir).toLowerCase();
  try {
    // Only sweep a real Squirrel layout (Update.exe above an app-* folder) —
    // zip/portable installs don't match and are left untouched.
    if (!ownDir.startsWith("app-")) return;
    await fs.access(path.join(rootDir, "Update.exe"));

    const stale: string[] = [];
    for (const entry of await fs.readdir(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.toLowerCase() === ownDir) continue;
      const version = /^app-(.+)$/i.exec(entry.name)?.[1];
      if (version && isVersionUpgrade(version, current)) {
        stale.push(path.join(rootDir, entry.name));
      }
    }
    const packagesDir = path.join(rootDir, "packages");
    const packages = await fs.readdir(packagesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of packages) {
      const version = /-((?:\d+\.)+\d+(?:-[A-Za-z0-9.]+)?)-(?:full|delta)\.nupkg$/i.exec(entry.name)?.[1];
      if (entry.isFile() && version && isVersionUpgrade(version, current)) {
        stale.push(path.join(packagesDir, entry.name));
      }
    }
    if (stale.length === 0) return;

    let removed = 0;
    for (const target of stale) {
      try {
        // Retries cover transient Windows locks (antivirus scans, a previous
        // version's process still on its way out).
        await fs.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 500 });
        removed++;
      } catch (err) {
        console.error(`[updater] failed to remove stale ${target}:`, err);
      }
    }
    console.log(`[updater] swept ${removed}/${stale.length} stale Squirrel entries from ${rootDir}`);
    capture("update_cleaned", { removed, failed: stale.length - removed });
  } catch {
    // Not a Squirrel install, or the install root was unreadable — nothing
    // to sweep.
  }
}

/**
 * Manual "Check for updates". Only meaningful when idle or errored;
 * checking/downloading are already in flight and ready is already staged.
 * Returns the snapshot after initiating.
 */
export function checkForUpdates(): UpdaterStatus {
  if (status.state === "idle" || status.state === "error") {
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setStatus({ state: "error", error: error.message, lastCheckedAt: status.lastCheckedAt });
      capture("update_failed", { message: error.message });
    }
  }
  return status;
}

export function quitAndInstallUpdate(): void {
  capture("update_restarted", { from: status.version, to: status.newVersion });
  autoUpdater.quitAndInstall();
}
