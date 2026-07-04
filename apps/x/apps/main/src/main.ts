import { app, BrowserWindow, desktopCapturer, protocol, net, shell, session, type Session } from "electron";
import path from "node:path";
import {
  setupIpcHandlers,
  startRunsWatcher,
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
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initEmailLabeling } from "@x/core/dist/knowledge/label_emails.js";
import { init as initNoteTagging } from "@x/core/dist/knowledge/tag_notes.js";
import { init as initInlineTasks } from "@x/core/dist/knowledge/inline_tasks.js";
import { init as initAgentRunner } from "@x/core/dist/agent-schedule/runner.js";
import { init as initAgentNotes } from "@x/core/dist/knowledge/agent_notes.js";
import { init as initCalendarNotifications } from "@x/core/dist/knowledge/notify_calendar_meetings.js";
import { init as initLiveNoteScheduler } from "@x/core/dist/knowledge/live-note/scheduler.js";
import { init as initEventProcessor, registerConsumer } from "@x/core/dist/events/init.js";
import { liveNoteEventConsumer } from "@x/core/dist/knowledge/live-note/event-consumer.js";
import { init as initBackgroundTaskScheduler } from "@x/core/dist/background-tasks/scheduler.js";
import { backgroundTaskEventConsumer } from "@x/core/dist/background-tasks/event-consumer.js";
import { init as initAppsServer, shutdown as shutdownAppsServer } from "@x/core/dist/apps/server.js";
import { registerAppsHostApi } from "@x/core/dist/apps/host-api.js";
import { shutdown as shutdownAnalytics } from "@x/core/dist/analytics/posthog.js";
import { identifyIfSignedIn } from "@x/core/dist/analytics/identify.js";

import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import { getAgentSlackCliStatus } from "@x/core/dist/slack/agent-slack-exec.js";
import { resolveWorkspacePath } from "@x/core/dist/workspace/workspace.js";
import started from "electron-squirrel-startup";
import { execFileSync } from "node:child_process";
import { init as initChromeSync } from "@x/core/dist/knowledge/chrome-extension/server/server.js";
import container, { registerBrowserControlService, registerNotificationService } from "@x/core/dist/di/container.js";
import type { CodeModeManager } from "@x/core/dist/code-mode/acp/manager.js";
import { browserViewManager, BROWSER_PARTITION } from "./browser/view.js";
import { setupBrowserEventForwarding } from "./browser/ipc.js";
import { ElectronBrowserControlService } from "./browser/control-service.js";
import { ElectronNotificationService } from "./notification/electron-notification-service.js";
import {
  DEEP_LINK_SCHEME,
  dispatchUrl,
  extractDeepLinkFromArgv,
  setMainWindowForDeepLinks,
} from "./deeplink.js";
import { disconnectGoogleIfScopesStale } from "./oauth-handler.js";

// Captured as early as possible so it reflects actual process start. Used to
// gate grace-eligible notifications (e.g. the burst of background-task
// completions a reopen replays) — see ElectronNotificationService.
const APP_LAUNCHED_AT = Date.now();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

function configureSessionPermissions(targetSession: Session): void {
  targetSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_SESSION_PERMISSIONS.has(permission);
  });

  targetSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_SESSION_PERMISSIONS.has(permission));
  });

  // Auto-approve display media requests and route system audio as loopback.
  // Electron requires a video source in the callback even if we only want audio.
  // We pass the first available screen source; the renderer discards the video track.
  targetSession.setDisplayMediaRequestHandler(async (_request, callback) => {
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

function createWindow() {
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
  configureSessionPermissions(session.fromPartition(BROWSER_PARTITION));

  setMainWindowForDeepLinks(win);
  win.on("closed", () => setMainWindowForDeepLinks(null));

  // Show window when content is ready to prevent blank screen
  win.once("ready-to-show", () => {
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

app.whenReady().then(async () => {
  // Register custom protocol before creating window.
  // In production this serves the renderer SPA; in dev (and prod) it also
  // serves workspace files via app://workspace/<rel-path> for media previews.
  registerAppProtocol();

  // Initialize auto-updater (only in production)
  if (app.isPackaged) {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "rowboatlabs/rowboat",
      },
      notifyUser: true, // Shows native dialog when update is available
    });
  }

  // The agent-slack CLI ships bundled with the app (.package/dist/agent-slack.cjs)
  // and is resolved per call by the shared executor in @x/core. Availability is
  // exposed to the UI via the slack:cliStatus IPC channel; this startup log is
  // diagnostics only.
  getAgentSlackCliStatus().then((status) => {
    console.log('[Slack] agent-slack CLI status:', status);
  }).catch(() => { /* probe failures already surface through slack:cliStatus */ });

  // Initialize all config files before UI can access them
  await initConfigs();

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

  createWindow();

  // Start workspace watcher as a main-process service
  // Watcher runs independently and catches ALL filesystem changes:
  // - Changes made via IPC handlers (workspace:writeFile, etc.)
  // - External changes (terminal, git, other editors)
  // Only starts once (guarded in startWorkspaceWatcher)
  startWorkspaceWatcher();

  // start runs watcher
  startRunsWatcher();

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

  // start email labeling service
  initEmailLabeling();

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

  // start chrome extension sync server
  initChromeSync();

  // start the Rowboat Apps server (per-app origins on 127.0.0.1:3210) with the
  // full Host API (tools/fetch/llm/copilot behind the capability gate)
  registerAppsHostApi();
  initAppsServer().catch((error) => {
    console.error('[Apps] Failed to start:', error);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  // Clean up watcher on app quit
  stopWorkspaceWatcher();
  stopRunsWatcher();
  stopServicesWatcher();
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
