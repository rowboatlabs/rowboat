import { app, autoUpdater, dialog, net, nativeImage, BrowserWindow } from "electron";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import fs from "node:fs";
import path from "node:path";
import { WorkDir } from "@x/core/dist/config/config.js";
import { capture } from "@x/core/dist/analytics/posthog.js";
import type { ipc } from "@x/shared";

export type UpdaterStatus = ipc.IPCChannels["updater:status"]["req"];

// Cross-launch prefs: the /Applications move prompt opt-out, and the
// restart-prompt snooze (so "Later" survives window reloads and reopens).
const PREFS_PATH = path.join(WorkDir, "config", "updater.json");

interface UpdaterPrefs {
  suppressMovePrompt?: boolean;
  snoozeUntil?: number;
}

// How long "Later" defers the proactive restart prompt. The update still
// applies on the next natural restart; Settings always offers it too.
const SNOOZE_MS = 24 * 60 * 60 * 1000;

let status: UpdaterStatus = { state: "disabled", version: "", reason: "dev" };

// Squirrel surfaces connectivity loss as generic Errors; match the usual
// Node/Chromium/NSURLError shapes so a flaky connection doesn't read as a
// broken updater. net.isOnline() covers whatever the regex misses.
const NETWORK_ERROR_RE =
  /ENOTFOUND|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|net::ERR_|internet connection appears to be offline|could not connect to the server|hostname could not be found|network connection was lost/i;

function isNetworkError(err: Error): boolean {
  return NETWORK_ERROR_RE.test(err.message) || !net.isOnline();
}

/**
 * Network blips go to `offline` (soft UI, no analytics — the periodic check
 * retries on its own); everything else is a real `error`.
 */
function reportUpdateError(err: Error): void {
  if (isNetworkError(err)) {
    setStatus({ state: "offline", lastCheckedAt: status.lastCheckedAt });
    return;
  }
  setStatus({ state: "error", error: err.message, lastCheckedAt: status.lastCheckedAt });
  capture("update_failed", { message: err.message });
}

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
 * (updater:status), which shows the non-modal "restart to update" card at a
 * moment the user isn't busy.
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
    // /Applications (DMG mount, ~/Downloads). Don't wire the updater yet —
    // offer the move instead. A successful move relaunches the app; a manual
    // drag while running is picked up by the focus re-check below.
    status = { state: "unsupported", version, reason: "not-in-applications" };
    promptMoveWhenWindowVisible();
    watchForManualMove();
    return;
  }

  status = { state: "idle", version };
  wireUpdater();
}

/**
 * Attach autoUpdater listeners and start the periodic check. Called once —
 * either at init, or later from the focus re-check once the app lands in
 * /Applications.
 */
function wireUpdater(): void {
  autoUpdater.on("checking-for-update", () => {
    setStatus({ state: "checking", lastCheckedAt: status.lastCheckedAt });
  });
  autoUpdater.on("update-available", () => {
    setStatus({ state: "downloading" });
  });
  autoUpdater.on("update-not-available", () => {
    setStatus({ state: "idle", lastCheckedAt: Date.now() });
  });
  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    // A snooze from before an app restart carries over if still current —
    // "Later" means "not today", even if a fresh download re-staged since.
    const snoozeUntil = readPrefs().snoozeUntil;
    // releaseName is only populated on Windows (Squirrel.Windows).
    setStatus({
      state: "ready",
      newVersion: releaseName || undefined,
      snoozedUntil: snoozeUntil && snoozeUntil > Date.now() ? snoozeUntil : undefined,
    });
    showReadyBadge();
  });
  autoUpdater.on("error", (err) => {
    reportUpdateError(err);
  });

  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: "rowboatlabs/rowboat",
    },
    notifyUser: false,
  });
}

/**
 * Manual "Check for updates". Only meaningful once the updater is wired
 * (idle/error/offline); checking/downloading are already in flight and ready
 * is already staged. Returns the snapshot after initiating.
 */
export function checkForUpdates(): UpdaterStatus {
  if (status.state === "idle" || status.state === "error" || status.state === "offline") {
    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      reportUpdateError(err instanceof Error ? err : new Error(String(err)));
    }
  }
  return status;
}

/**
 * "Later" on the restart prompt: defer re-offering for SNOOZE_MS. Persisted
 * so it holds across window reloads/reopens (and app restarts, in the rare
 * case an update re-stages within the window). Returns the snapshot.
 */
export function snoozeUpdateNotice(): UpdaterStatus {
  if (status.state === "ready") {
    const snoozeUntil = Date.now() + SNOOZE_MS;
    writePrefs({ snoozeUntil });
    setStatus({ state: "ready", newVersion: status.newVersion, snoozedUntil: snoozeUntil });
  }
  return status;
}

export function quitAndInstallUpdate(): void {
  // The user engaged with the prompt — a leftover "Later" shouldn't suppress
  // the next update's prompt after this install. (undefined drops the key.)
  writePrefs({ snoozeUntil: undefined });
  capture("update_restarted", { from: status.version, to: status.newVersion });
  autoUpdater.quitAndInstall();
}

/** Returns false when the move failed or the user declined the OS prompt. */
export function moveToApplications(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    // Relaunches from the new location on success. The default conflict
    // handler prompts if a copy already exists in /Applications.
    return app.moveToApplicationsFolder();
  } catch (err) {
    console.error("[Updater] moveToApplicationsFolder failed:", err);
    return false;
  }
}

/**
 * initUpdater runs before any window exists — an unparented dialog there
 * would float alone on screen before the app has even appeared. Wait for the
 * main window to become visible and attach the prompt to it as a sheet.
 */
function promptMoveWhenWindowVisible(): void {
  const attach = (win: BrowserWindow) => {
    if (win.isVisible()) void promptMoveToApplications(win);
    else win.once("show", () => void promptMoveToApplications(win));
  };
  const existing = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (existing) attach(existing);
  else app.once("browser-window-created", (_event, win) => attach(win));
}

/**
 * If the user drags the app into /Applications themselves while it's
 * running, pick that up on the next window focus and wire the updater —
 * no relaunch needed. (The in-app move button relaunches, bypassing this.)
 */
function watchForManualMove(): void {
  const recheck = () => {
    if (!app.isInApplicationsFolder()) return;
    app.removeListener("browser-window-focus", recheck);
    setStatus({ state: "idle" });
    wireUpdater();
  };
  app.on("browser-window-focus", recheck);
}

async function promptMoveToApplications(parent: BrowserWindow): Promise<void> {
  if (readPrefs().suppressMovePrompt) return;
  const { response, checkboxChecked } = await dialog.showMessageBox(parent, {
    type: "info",
    message: "Move Rowboat to the Applications folder?",
    detail:
      "Rowboat can only install updates automatically when it runs from the Applications folder.",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    checkboxLabel: "Don't ask again",
  });
  if (checkboxChecked) writePrefs({ suppressMovePrompt: true });
  if (response !== 0) return;
  if (!moveToApplications() && !parent.isDestroyed()) {
    // Gatekeeper app translocation (and declined OS conflict prompts) make
    // the move fail without any OS feedback — give the manual path.
    await dialog.showMessageBox(parent, {
      type: "warning",
      message: "Couldn't move Rowboat",
      detail: "Quit Rowboat and drag it into the Applications folder instead.",
    });
  }
}

function readPrefs(): UpdaterPrefs {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8")) as UpdaterPrefs;
  } catch {
    return {};
  }
}

function writePrefs(patch: UpdaterPrefs): void {
  try {
    fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
    fs.writeFileSync(PREFS_PATH, JSON.stringify({ ...readPrefs(), ...patch }, null, 2));
  } catch (err) {
    console.error("[Updater] Failed to write updater.json:", err);
  }
}
