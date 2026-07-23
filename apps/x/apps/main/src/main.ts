import { app, BrowserWindow, desktopCapturer, dialog, protocol, net, shell, session, safeStorage, type Session } from "electron";
import path from "node:path";
import os from "node:os";
import {
  setupIpcHandlers,
  startRunsWatcher, startSessionsWatcher, startTurnEventsWatcher, markSessionsIndexReady,
  startCodeRunFeedWatcher,
  startChannelsWatcher,
  startCodeSessionStatusWatcher,
  startServicesWatcher,
  startLiveNoteAgentWatcher,
  startBackgroundTaskAgentWatcher,
  startWorkspaceWatcher,
  stopRunsWatcher,
  stopServicesWatcher,
  stopWorkspaceWatcher
} from "./ipc.js";
import { disposeAllTerminals } from "./terminal.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { initUpdater } from "./updater.js";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initNoteTagging } from "@x/core/dist/knowledge/tag_notes.js";
import { init as initInlineTasks } from "@x/core/dist/knowledge/inline_tasks.js";
import { init as initAgentRunner } from "@x/core/dist/agent-schedule/runner.js";
import { init as initChannels } from "@x/core/dist/channels/service.js";
import { init as initAgentNotes } from "@x/core/dist/knowledge/agent_notes.js";
import { init as initCalendarNotifications } from "@x/core/dist/knowledge/notify_calendar_meetings.js";
import { init as initMeetingPrep } from "@x/core/dist/knowledge/meeting_prep_scheduler.js";
import { init as initLiveNoteScheduler } from "@x/core/dist/knowledge/live-note/scheduler.js";
import { init as initEventProcessor, registerConsumer } from "@x/core/dist/events/init.js";
import { liveNoteEventConsumer } from "@x/core/dist/knowledge/live-note/event-consumer.js";
import { init as initBackgroundTaskScheduler } from "@x/core/dist/background-tasks/scheduler.js";
import { backgroundTaskEventConsumer } from "@x/core/dist/background-tasks/event-consumer.js";
import { startSkillsWatcher, stopSkillsWatcher } from "@x/core/dist/runtime/assembly/skills/watcher.js";
import { init as initAppsServer, shutdown as shutdownAppsServer } from "@x/core/dist/apps/server.js";
import { registerAppsHostApi } from "@x/core/dist/apps/host-api.js";
import { setTokenCipher as setGithubTokenCipher } from "@x/core/dist/apps/github-auth.js";
import { setTokenCipher as setChatGPTTokenCipher } from "@x/core/dist/auth/chatgpt-auth.js";
import { shutdown as shutdownAnalytics } from "@x/core/dist/analytics/posthog.js";
import { identifyIfSignedIn } from "@x/core/dist/analytics/identify.js";
import { migrateRuns } from "@x/core/dist/migrations/runs/migrate.js";

import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import { getAgentSlackCliStatus } from "@x/core/dist/slack/agent-slack-exec.js";
import { resolveWorkspacePath } from "@x/core/dist/workspace/workspace.js";
import started from "electron-squirrel-startup";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { init as initChromeSync } from "@x/core/dist/knowledge/chrome-extension/server/server.js";
import container, { registerBrowserControlService, registerNotificationService } from "@x/core/dist/di/container.js";
import type { CodeModeManager } from "@x/core/dist/code-mode/acp/manager.js";
import type { ISessions } from "@x/core/dist/runtime/sessions/index.js";
import { browserViewManager, BROWSER_PARTITION } from "./browser/view.js";
import { setupBrowserEventForwarding } from "./browser/ipc.js";
import { setupBrowserExtensions } from "./browser/extensions.js";
import { ElectronBrowserControlService } from "./browser/control-service.js";
import { ElectronNotificationService } from "./notification/electron-notification-service.js";
import {
  DEEP_LINK_SCHEME,
  dispatchUrl,
  extractDeepLinkFromArgv,
  setMainWindowForDeepLinks,
} from "./deeplink.js";
import { disconnectGoogleIfScopesStale } from "./oauth-handler.js";
import { startModelsDevRefresh } from "@x/core/dist/models/models-dev.js";
import { loadAppSettings, saveAppSettings } from "@x/core/dist/config/app_settings.js";
import { init as initMeetingDetection } from "@x/core/dist/meetings/detector.js";
import { createAppTray, hasTray, isRecordingActive, markPendingToggleMeetingNotes } from "./tray.js";
import { initMeetingPopup, showMeetingPopup } from "./meeting-popup.js";
import { initQuickAsk } from "./quick-ask.js";

// Captured as early as possible so it reflects actual process start. Used to
// gate grace-eligible notifications (e.g. the burst of background-task
// completions a reopen replays) — see ElectronNotificationService.
const APP_LAUNCHED_AT = Date.now();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// fs.watch failures (EMFILE fd exhaustion, ENOSPC watch limits) surface as
// uncaught exceptions from Node's watcher internals, bypassing chokidar's
// 'error' handlers. Watching is a degradable feature — log and keep running.
// Everything else keeps Electron's default behavior (native error dialog),
// which we replicate since registering any listener suppresses it.
process.on('uncaughtException', (err) => {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if ((code === 'EMFILE' || code === 'ENOSPC') && (err?.stack ?? '').includes('FSWatcher')) {
    console.error('[Main] file watcher error (non-fatal):', err);
    return;
  }
  console.error('[Main] uncaught exception:', err);
  dialog.showErrorBox(
    'A JavaScript error occurred in the main process',
    err?.stack ?? String(err),
  );
});

// run this as early in the main process as possible
if (started) app.quit();

// Single-instance lock: route a second launch (e.g. clicking a rowboat:// link)
// back into the existing process via the 'second-instance' event.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  console.error('[Main] Another Rowboat instance is already running; exiting this process.');
  app.quit();
  process.exit(0);
}

// Register as the OS handler for rowboat:// URLs.
// In dev, point at the right argv so the OS can re-invoke us correctly.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

// First-launch URL on Windows/Linux comes through argv.
{
  const initialUrl = extractDeepLinkFromArgv(process.argv);
  if (initialUrl) dispatchUrl(initialUrl);
}

// macOS sends URLs via 'open-url' (both first launch and while running).
app.on("open-url", (event, url) => {
  event.preventDefault();
  dispatchUrl(url);
});

// Subsequent launches on Windows/Linux land here via the single-instance lock.
app.on("second-instance", (_event, argv) => {
  const url = extractDeepLinkFromArgv(argv);
  if (url) dispatchUrl(url);
});

// Fix PATH for packaged Electron apps on macOS/Linux.
// Packaged apps inherit a minimal environment that doesn't include paths from
// the user's shell profile (such as those provided by nvm, Homebrew, etc.).
// The function below spawns the user's login shell and runs a Node.js one-liner
// to print the full environment as JSON, then merges it into process.env.
// This ensures the Electron app has the same PATH and environment as user shell
// (helping find tools installed via Homebrew/nvm/npm, etc.)
function initializeExecutionEnvironment(): void {
  if (process.platform === 'win32') return;

  const shell = process.env.SHELL || '/bin/zsh';

  try {
    const stdout = execFileSync(
      shell,
      ['-l', '-c', `node -p "JSON.stringify(process.env)"`],
      { encoding: 'utf8' }
    ).trim();

    const env = JSON.parse(stdout) as Record<string, string>;
    // Let the user's shell environment win for overlapping keys like PATH.
    // Finder/launched GUI apps on macOS often start with a stripped PATH.
    process.env = { ...process.env, ...env };
  } catch (error) {
    console.error('Failed to load shell environment', error);
  }
}
initializeExecutionEnvironment();

// Path resolution differs between development and production:
const preloadPath = app.isPackaged
  ? path.join(__dirname, "../preload/dist/preload.js")
  : path.join(__dirname, "../../../preload/dist/preload.js");
console.log("preloadPath", preloadPath);

const rendererPath = app.isPackaged
  ? path.join(__dirname, "../renderer/dist") // Production
  : path.join(__dirname, "../../../renderer/dist"); // Development
console.log("rendererPath", rendererPath);

// Register custom protocol for serving built renderer files in production
// AND for serving local workspace files to the renderer (images, PDFs, video).
//
//   app://workspace/<rel-path>  → workspace file (path-traversal guarded)
//   app://<anything-else>/...   → renderer SPA (existing behavior)
function registerAppProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);

    // Workspace files: app://workspace/<rel-path>
    if (url.host === "workspace") {
      try {
        const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        if (!relPath) return new Response("Not Found", { status: 404 });
        const absPath = resolveWorkspacePath(relPath);
        return net.fetch(pathToFileURL(absPath).toString());
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
    }

    // Renderer SPA — existing logic
    let urlPath = url.pathname;
    if (urlPath === "/" || !path.extname(urlPath)) {
      urlPath = "/index.html";
    }

    const filePath = path.join(rendererPath, urlPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      allowServiceWorkers: true,
      // Required for byte-range requests so <video> seeking works.
      stream: true,
    },
  },
]);

const ALLOWED_SESSION_PERMISSIONS = new Set(["media", "display-capture", "clipboard-read", "clipboard-sanitized-write"]);

// Granted to the embedded browser partition on top of the base set.
// `notifications` lets sites (WhatsApp Web, Gmail, Slack, ...) show native OS
// notifications via the HTML5 Notification API — Electron renders these
// through the system notification center once the permission resolves to
// granted. Background Web Push is still unavailable (Electron has no FCM),
// so notifications only fire while the site is loaded in a tab. The app's
// own renderer keeps the base set; it notifies through the main-process
// notification service instead.
const BROWSER_EXTRA_PERMISSIONS = ["notifications"] as const;

function configureSessionPermissions(targetSession: Session, extraPermissions: readonly string[] = []): void {
  const allowed = new Set([...ALLOWED_SESSION_PERMISSIONS, ...extraPermissions]);

  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowed.has(permission);
  });

  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowed.has(permission));
  });
}

// On Linux, Chromium's loopback capture records the default sink's monitor
// through the PulseAudio layer, at the monitor source's own volume. Desktop
// tools sometimes leave that volume near zero — it's invisible plumbing that
// doesn't affect what the user hears — which turns the whole capture into
// digital silence with no error anywhere. Raise it back to 100% before
// capture starts (raise only, so a deliberate >100% boost is left alone).
// Best-effort: no pactl or no Pulse layer just skips.
async function ensureLinuxMonitorVolume(): Promise<void> {
  const execFileP = promisify(execFile);
  try {
    const { stdout: sinkOut } = await execFileP("pactl", ["get-default-sink"], { timeout: 3000 });
    const monitor = `${sinkOut.trim()}.monitor`;
    const { stdout: volOut } = await execFileP("pactl", ["get-source-volume", monitor], { timeout: 3000 });
    const percents = [...volOut.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    if (percents.length === 0 || Math.min(...percents) >= 100) return;
    await execFileP("pactl", ["set-source-volume", monitor, "100%"], { timeout: 3000 });
    console.log(`[meeting] Raised ${monitor} volume from ${Math.min(...percents)}% to 100% for system-audio capture`);
  } catch {
    // pactl missing or non-Pulse audio stack — nothing to fix here.
  }
}

// Auto-approve display media requests and route system audio as loopback.
// Electron requires a video source in the callback even if we only want audio.
// We pass the first available screen source; the renderer discards the video track.
// App session only — the embedded browser partition registers its own handler
// (a user-facing source picker) in BrowserViewManager.
function configureAppDisplayMediaHandler(targetSession: Session): void {
  targetSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // On Linux, enumerating screens via desktopCapturer goes through the
    // Wayland screencast portal, which can block on a system dialog or hang
    // outright. Requests that want audio (meeting transcription — the only
    // audio consumer; it discards the video track) don't need a real screen,
    // so answer with the requesting frame as the mandatory video source and
    // Chromium's PulseAudio loopback for the audio.
    if (process.platform === 'linux' && request.audioRequested && request.frame) {
      await ensureLinuxMonitorVolume();
      callback({ video: request.frame, audio: 'loopback' });
      return;
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    if (sources.length === 0) {
      callback({});
      return;
    }
    callback({ video: sources[0], audio: 'loopback' });
  });
}

// Wire Ctrl/Cmd + (+ / − / 0) to zoom the renderer in/out/reset.
// The app sets no application menu, so the default menu's zoom roles aren't
// available — and on Linux the menu bar is suppressed by the frameless
// `hiddenInset` title bar — so handle the accelerators directly here.
// `event.preventDefault()` stops the keystroke from leaking into the editor.
function setupZoomShortcuts(win: BrowserWindow) {
  const ZOOM_STEP = 0.5; // zoom-level units (factor = 1.2 ^ level, ~9.5% per step)
  const MIN_ZOOM_LEVEL = -3;
  const MAX_ZOOM_LEVEL = 3;
  const wc = win.webContents;

  wc.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    // Cmd on macOS, Ctrl elsewhere.
    if (!(process.platform === "darwin" ? input.meta : input.control)) return;

    // input.key is the produced character: "+"/"=" share a physical key (as do
    // "-"/"_"), and numpad +/- produce the same characters, so this covers both.
    const key = input.key;
    if (key === "+" || key === "=") {
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + ZOOM_STEP, MAX_ZOOM_LEVEL));
      event.preventDefault();
    } else if (key === "-" || key === "_") {
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - ZOOM_STEP, MIN_ZOOM_LEVEL));
      event.preventDefault();
    } else if (key === "0") {
      wc.setZoomLevel(0);
      event.preventDefault();
    }
  });
}

// Resident-app plumbing (Granola-style): the main window may exist hidden
// (launched at login) or not at all (closed on macOS) while the app keeps
// running from the tray. showApp() is the single "bring the app up" path
// used by the tray, the Dock, and pending tray commands.
let mainWindow: BrowserWindow | null = null;

function showApp(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
  // The user is usually in another app (a meeting!) when this runs — a plain
  // focus() won't take the foreground from it.
  app.focus({ steal: true });
}

/**
 * Was this process launched by the OS at login (rather than by the user)?
 * Used to start with the window hidden so login launches are invisible.
 *
 * - Windows: our login item registers with an explicit --hidden arg.
 * - macOS: wasOpenedAtLogin when available. On macOS 13+ (SMAppService)
 *   Electron doesn't reliably populate it (electron#37244), so fall back to
 *   a heuristic: a packaged launch while registered as a login item within
 *   two minutes of boot is treated as a login launch.
 */
function wasLaunchedAtLogin(): boolean {
  if (process.argv.includes("--hidden")) return true;
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  try {
    const settings = app.getLoginItemSettings();
    if (settings.wasOpenedAtLogin) return true;
    return settings.openAtLogin && os.uptime() < 120;
  } catch {
    return false;
  }
}

function createWindow(options: { startHidden?: boolean } = {}) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 600,
    minHeight: 480,
    show: false, // Don't show until ready
    backgroundColor: "#252525", // Prevent white flash (matches dark mode)
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    icon: process.platform !== "darwin" ? path.join(__dirname, "../../icons/icon.png") : undefined,
    webPreferences: {
      // IMPORTANT: keep Node out of renderer
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      // Enable Chromium's built-in PDFium plugin so <iframe src="*.pdf">
      // renders PDFs natively (zoom/scroll/print toolbar included).
      plugins: true,
    },
  });

  configureSessionPermissions(session.defaultSession);
  configureAppDisplayMediaHandler(session.defaultSession);
  configureSessionPermissions(session.fromPartition(BROWSER_PARTITION), BROWSER_EXTRA_PERMISSIONS);

  mainWindow = win;
  setMainWindowForDeepLinks(win);
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
    setMainWindowForDeepLinks(null);
  });

  // Show window when content is ready to prevent blank screen.
  // Launched-at-login starts stay hidden: the app is reachable from the
  // tray/Dock, and showApp() maximizes on first reveal.
  win.once("ready-to-show", () => {
    if (options.startHidden) return;
    win.maximize();
    win.show();
  });

  // Open external links in system browser (not sandboxed Electron window)
  // This handles window.open() and target="_blank" links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Handle navigation to external URLs (e.g., clicking a link without target="_blank").
  // Returns true when the URL was external and routed to the system browser.
  const routeExternalNavigation = (url: string): boolean => {
    const isInternal =
      url.startsWith("app://") || url.startsWith("http://localhost:5173");
    if (isInternal) return false;
    shell.openExternal(url);
    return true;
  };

  win.webContents.on("will-navigate", (event, url) => {
    if (routeExternalNavigation(url)) event.preventDefault();
  });

  // Subframe navigations (e.g. links clicked inside the sandboxed iframe that
  // renders a background-task / workspace `index.html`) fire `will-frame-navigate`,
  // not `will-navigate`. Route their external links to the system browser too,
  // so HTML reports behave like the markdown viewer. Main-frame navigations are
  // already handled by `will-navigate` above — skip them here to avoid double-open.
  //
  // Scope this to our own HTML viewer frames (identified by their app://workspace
  // document origin). Third-party note embeds (YouTube, Figma, Twitter via the
  // embed/iframe blocks) load from their own origins — leave their internal
  // navigation untouched so the embeds keep working.
  win.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    if (!event.frame?.url.startsWith("app://workspace/")) return;
    if (routeExternalNavigation(event.url)) event.preventDefault();
  });

  // Attach the embedded browser pane manager to this window.
  // The WebContentsView is created lazily on first `browser:setVisible`.
  browserViewManager.attach(win);

  // Cmd/Ctrl + (+ / − / 0) zoom shortcuts for the renderer UI.
  setupZoomShortcuts(win);

  if (app.isPackaged) {
    win.loadURL("app://-/index.html");
  } else {
    win.loadURL("http://localhost:5173");
  }
}

// Renderer/child process deaths are otherwise silent in packaged builds (the
// window or an app iframe just goes blank). Log the reason so crash reports
// can be correlated with what Chromium thought happened.
app.on('render-process-gone', (_event, webContents, details) => {
  console.error(`[Crash] renderer gone: reason=${details.reason} exitCode=${details.exitCode} url=${webContents.getURL()}`);
});
app.on('child-process-gone', (_event, details) => {
  console.error(`[Crash] child process gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode ?? ''} name=${details.name ?? ''}`);
});

app.whenReady().then(async () => {
  // Register custom protocol before creating window.
  // In production this serves the renderer SPA; in dev (and prod) it also
  // serves workspace files via app://workspace/<rel-path> for media previews.
  registerAppProtocol();

  // Initialize auto-updater (no-ops in dev). Update state is pushed to the
  // renderer (updater:status), which owns the restart prompt — see updater.ts.
  initUpdater();

  // The agent-slack CLI ships bundled with the app (.package/dist/agent-slack.cjs)
  // and is resolved per call by the shared executor in @x/core. Availability is
  // exposed to the UI via the slack:cliStatus IPC channel; this startup log is
  // diagnostics only.
  getAgentSlackCliStatus().then((status) => {
    console.log('[Slack] agent-slack CLI status:', status);
  }).catch(() => { /* probe failures already surface through slack:cliStatus */ });

  // Initialize all config files before UI can access them
  await initConfigs();

  // Warm the models.dev catalog cache (single writer; refreshed every 24h
  // while the app runs). Every consumer — catalog listings, the reasoning
  // capability gate — reads the on-disk cache only. Best-effort: failures
  // leave any existing cache in use and never block boot.
  startModelsDevRefresh();

  // PostHog identify() is idempotent — call it on every startup so existing
  // signed-in installs (and every cold start of v0.3.4+) get re-identified.
  // Otherwise main-process events stay anonymous until the user re-signs-in.
  identifyIfSignedIn().catch((error) => {
    console.error('[Analytics] Failed to identify on startup:', error);
  });

  registerBrowserControlService(new ElectronBrowserControlService());
  registerNotificationService(new ElectronNotificationService(APP_LAUNCHED_AT));

  setupIpcHandlers();
  setupBrowserEventForwarding();
  setupBrowserExtensions();

  // Quick-ask bar: global ⌥Space summons a Spotlight-style ask-anything
  // window over whatever app the user is in.
  initQuickAsk();

  // Start the Rowboat Apps server (per-app origins on 127.0.0.1:3210) BEFORE
  // the window and the long service-init chain below. The Apps view is
  // reachable as soon as the window paints; starting the server last meant
  // every app iframe hit connection-refused (blank app) for the first ~10s of
  // each launch. Route registration and the token cipher are synchronous;
  // the listen itself is fire-and-forget.
  registerAppsHostApi();
  // GitHub publish token at rest: encrypt via the OS keychain when available
  // (core stays electron-free; the cipher is injected here).
  setGithubTokenCipher({
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  });
  // ChatGPT subscription tokens at rest: same keychain-backed cipher.
  setChatGPTTokenCipher({
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  });
  initAppsServer().catch((error) => {
    console.error('[Apps] Failed to start:', error);
  });

  // Resident app (Granola-style): register as an OS login item once, on the
  // first packaged run. After that the OS registry is the source of truth —
  // the Settings toggle writes it directly, and disabling the login item in
  // System Settings sticks because we never re-register on boot.
  if (app.isPackaged && !loadAppSettings().loginItemRegistered) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        ...(process.platform === "win32" ? { args: ["--hidden"] } : {}),
      });
      saveAppSettings({ loginItemRegistered: true });
    } catch (error) {
      console.error("[LoginItem] Failed to register login item:", error);
    }
  }

  createWindow({ startHidden: wasLaunchedAtLogin() });

  // Menu bar icon: open the app / start-stop meeting notes without the
  // window. If the renderer isn't ready to receive the toggle (window closed
  // or still loading), park it as a pending command the renderer drains on
  // mount — same pull pattern as pending deep links.
  createAppTray({
    openApp: showApp,
    toggleMeetingNotes: () => {
      const hadWindow = mainWindow !== null && !mainWindow.isDestroyed();
      showApp();
      const win = mainWindow;
      if (!hadWindow || !win || win.webContents.isLoading()) {
        markPendingToggleMeetingNotes();
        return;
      }
      win.webContents.send("app:toggleMeetingNotes", null);
    },
  });

  // Ambient meeting detection (Granola-style): the mic-monitor helper +
  // running-app scan produce "Meeting detected" events; the popup asks
  // before anything records. Clicking "Take Notes" routes into the same
  // renderer flow as the calendar notification.
  initMeetingPopup({
    onTakeNotes: (meeting) => {
      showApp();
      // The user may have started recording between popup and click —
      // sending the take-notes flow then would toggle it OFF.
      if (isRecordingActive()) return;
      const payload = {
        event: meeting.calendarEvent ?? { summary: meeting.noteTitle },
        openMeeting: false,
        source: "detected",
      };
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => {
          if (!win.isDestroyed()) win.webContents.send("app:takeMeetingNotes", payload);
        });
        return;
      }
      win.webContents.send("app:takeMeetingNotes", payload);
    },
  });
  initMeetingDetection({
    helperPath: path.join(__dirname, "mic-monitor"),
    onDetected: (meeting) => showMeetingPopup(meeting),
    // Call ended while recording (meeting app released the mic) — the
    // renderer stops capture and generates notes, same as a manual stop.
    onExternalCallEnded: () => {
      const win = mainWindow;
      if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
      win.webContents.send("meeting:externalCallEnded", null);
    },
  });

  // Start workspace watcher as a main-process service
  // Watcher runs independently and catches ALL filesystem changes:
  // - Changes made via IPC handlers (workspace:writeFile, etc.)
  // - External changes (terminal, git, other editors)
  // Only starts once (guarded in startWorkspaceWatcher)
  startWorkspaceWatcher();

  // start runs watcher
  startRunsWatcher();

  // One-time: port legacy runs/*.jsonl into the new turn/session runtime.
  // Must run BEFORE the session index is built so migrated sessions are picked
  // up by the startup scan. Fully defensive — never blocks boot.
  try {
    const migration = migrateRuns();
    if (migration.scanned > 0) {
      console.log(
        `[runs-migration] migrated ${migration.migratedTurns} turn(s) across ` +
        `${migration.migratedSessions} session(s) from ${migration.scanned} run(s) ` +
        `(${migration.skipped} skipped, ${migration.failed.length} failed)`,
      );
      for (const failure of migration.failed) {
        console.warn(`[runs-migration] left in place (failed): ${failure.file} — ${failure.error}`);
      }
    }
  } catch (error) {
    console.error('[runs-migration] pass failed:', error);
  }

  // New runtime: build the in-memory session index (startup scan), then
  // forward the session bus to windows. The renderer window is already up and
  // may have called sessions:list — that handler blocks on
  // markSessionsIndexReady, which must fire even if the scan throws so the
  // list never hangs.
  try {
    await container.resolve<ISessions>('sessions').initialize();
  } finally {
    markSessionsIndexReady();
  }
  startSessionsWatcher();
  // Turn event spine: durable events of every turn (session, headless,
  // sub-agent) → renderer, for turnId-keyed live views.
  startTurnEventsWatcher();
  startCodeRunFeedWatcher();

  // Mobile channels (WhatsApp/Telegram bridge): needs the session index, so
  // start after initialize(). Failures must never block boot.
  startChannelsWatcher();
  initChannels().catch((error) => {
    console.error('[Channels] Failed to start mobile channels:', error);
  });

  // start code-session status tracker (derives working/needs-you/idle + notifications)
  startCodeSessionStatusWatcher();

  // start services watcher
  startServicesWatcher();

  // start live-note agent event watcher (forwards bus → renderer)
  startLiveNoteAgentWatcher();

  // start bg-task agent event watcher (forwards bus → renderer)
  startBackgroundTaskAgentWatcher();

  // start live-note scheduler (cron / window)
  initLiveNoteScheduler();

  // start bg-task scheduler (cron / window)
  initBackgroundTaskScheduler();

  // start disk-skills watcher: live-reload skills dropped into
  // ~/.rowboat/skills or ~/.agents/skills without an app restart
  startSkillsWatcher();

  // register event consumers and start the shared event processor
  // (consumes $WorkDir/events/pending/, routes events to all consumers
  // concurrently for Pass-1, then fires each consumer's candidates in parallel)
  registerConsumer(liveNoteEventConsumer);
  registerConsumer(backgroundTaskEventConsumer);
  initEventProcessor();

  // If the stored Google grant predates a scope change (only old scopes),
  // disconnect it now so the user re-connects with the current scopes before
  // any Google sync runs against the stale grant.
  await disconnectGoogleIfScopesStale();

  // start gmail sync
  initGmailSync();

  // start calendar sync
  initCalendarSync();

  // start fireflies sync
  initFirefliesSync();

  // start granola sync
  initGranolaSync();

  // start knowledge graph builder
  initGraphBuilder();

  // start note tagging service
  initNoteTagging();

  // start inline task service (@rowboat: mentions)
  initInlineTasks();

  // start background agent runner (scheduled agents)
  initAgentRunner();

  // start agent notes learning service
  initAgentNotes();

  // start calendar meeting notification service (fires 1-minute warnings)
  initCalendarNotifications();

  // start meeting prep scheduler (generates prep notes ~6h before a meeting)
  void initMeetingPrep();

  // start chrome extension sync server
  initChromeSync();

  app.on("activate", () => {
    // Reveal the hidden/closed main window (login launches start hidden).
    showApp();
  });
});

app.on("window-all-closed", () => {
  // Resident app: with a tray present, keep running with no windows so
  // meeting detection/notifications stay alive (Granola-style). Without a
  // tray (creation failed), fall back to the platform-default quit.
  if (process.platform !== "darwin" && !hasTray()) {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Clean up watcher on app quit
  stopWorkspaceWatcher();
  stopRunsWatcher();
  stopServicesWatcher();
stopSkillsWatcher();
  // Tear down any live ACP coding-agent adapter processes so they don't outlive the app.
  try {
    container.resolve<CodeModeManager>('codeModeManager').disposeAll();
  } catch {
    // nothing live to dispose
  }
  // Kill embedded terminal shells.
  disposeAllTerminals();
  shutdownAppsServer().catch((error) => {
    console.error('[Apps] Failed to shut down cleanly:', error);
  });
  shutdownAnalytics().catch((error) => {
    console.error('[Analytics] Failed to flush on quit:', error);
  });
});
