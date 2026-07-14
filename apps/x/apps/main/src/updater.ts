import { app, autoUpdater, net, nativeImage, BrowserWindow } from "electron";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { capture } from "@x/core/dist/analytics/posthog.js";
import type { ipc } from "@x/shared";

export type UpdaterStatus = ipc.IPCChannels["updater:status"]["req"];

const REPO = "rowboatlabs/rowboat";

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
 * Initialize auto-update. Replaces update-electron-app's `notifyUser` native
 * dialog with our own state machine: events are forwarded to the renderer
 * (updater:status), which shows a "Restart to update" card once the update
 * is staged. By then Squirrel has already installed it — the card only asks
 * for the restart, Chrome-style.
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
    // name. Whatever is missing is backfilled from the GitHub API below.
    setStatus({
      state: "ready",
      newVersion: releaseName || undefined,
      releaseNotes: releaseNotes || undefined,
    });
    showReadyBadge();
    if (!releaseNotes) void backfillReleaseNotes(releaseName || undefined);
  });
  autoUpdater.on("error", (err) => {
    setStatus({ state: "error", error: err.message, lastCheckedAt: status.lastCheckedAt });
    capture("update_failed", { message: err.message });
  });

  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: REPO,
    },
    notifyUser: false,
  });
}

/**
 * Fetch the GitHub release body for the staged update so the restart card
 * can show "What's new" inline. Best-effort: on any failure the card simply
 * omits the notes and keeps the link to the releases page.
 */
async function backfillReleaseNotes(releaseName: string | undefined): Promise<void> {
  const url = releaseName
    ? `https://api.github.com/repos/${REPO}/releases/tags/${releaseName.startsWith("v") ? releaseName : `v${releaseName}`}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  try {
    const res = await net.fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Rowboat" },
    });
    if (!res.ok) return;
    const release = (await res.json()) as { tag_name?: string; body?: string };
    // A newer download may have re-staged meanwhile — only fill in gaps.
    if (status.state !== "ready" || status.releaseNotes) return;
    if (!release.body) return;
    setStatus({
      state: "ready",
      newVersion: status.newVersion ?? release.tag_name,
      releaseNotes: release.body,
    });
  } catch (err) {
    console.error("[Updater] release notes fetch failed:", err);
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
