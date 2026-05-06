import { app, BrowserWindow, desktopCapturer, protocol, net, shell, session, type Session } from "electron";
import path from "node:path";
import {
  setupIpcHandlers,
  startRunsWatcher,
  startServicesWatcher,
  startTracksWatcher,
  startWorkspaceWatcher,
  stopRunsWatcher,
  stopServicesWatcher,
  stopWorkspaceWatcher
} from "./ipc.js";
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
import { init as initTrackScheduler } from "@x/core/dist/knowledge/track/scheduler.js";
import { init as initTrackEventProcessor } from "@x/core/dist/knowledge/track/events.js";
import { init as initLocalSites, shutdown as shutdownLocalSites } from "@x/core/dist/local-sites/server.js";
import { shutdown as shutdownAnalytics } from "@x/core/dist/analytics/posthog.js";
import { identifyIfSignedIn } from "@x/core/dist/analytics/identify.js";

import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import started from "electron-squirrel-startup";
import { execSync, exec, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { init as initChromeSync } from "@x/core/dist/knowledge/chrome-extension/server/server.js";
import { registerBrowserControlService, registerNotificationService } from "@x/core/dist/di/container.js";
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

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// run this as early in the main process as possible
if (started) app.quit();

// Single-instance lock: route a second launch (e.g. clicking a rowboat:// link)
// back into the existing process via the 'second-instance' event.
if (!app.requestSingleInstanceLock()) {
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

// Register custom protocol for serving built renderer files in production.
// This keeps SPA routes working when users deep link into the packaged app.
function registerAppProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);

    // url.pathname starts with "/"
    let urlPath = url.pathname;

    // If it's "/" or a SPA route (no extension), serve index.html
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
      // optional but often helpful:
      // stream: true,
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
    webPreferences: {
      // IMPORTANT: keep Node out of renderer
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
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

  // Handle navigation to external URLs (e.g., clicking a link without target="_blank")
  win.webContents.on("will-navigate", (event, url) => {
    const isInternal =
      url.startsWith("app://") || url.startsWith("http://localhost:5173");
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Attach the embedded browser pane manager to this window.
  // The WebContentsView is created lazily on first `browser:setVisible`.
  browserViewManager.attach(win);

  if (app.isPackaged) {
    win.loadURL("app://-/index.html");
  } else {
    win.loadURL("http://localhost:5173");
  }
}

app.whenReady().then(async () => {
  // Register custom protocol before creating window (for production builds)
  if (app.isPackaged) {
    registerAppProtocol();
  }

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

  // Ensure agent-slack CLI is available
  try {
    execSync('agent-slack --version', { stdio: 'ignore', timeout: 5000 });
  } catch {
    try {
      console.log('agent-slack not found, installing...');
      await execAsync('npm install -g agent-slack', { timeout: 60000 });
      console.log('agent-slack installed successfully');
    } catch (e) {
      console.error('Failed to install agent-slack:', e);
    }
  }

  // Initialize all config files before UI can access them
  await initConfigs();

  // PostHog identify() is idempotent — call it on every startup so existing
  // signed-in installs (and every cold start of v0.3.4+) get re-identified.
  // Otherwise main-process events stay anonymous until the user re-signs-in.
  identifyIfSignedIn().catch((error) => {
    console.error('[Analytics] Failed to identify on startup:', error);
  });

  registerBrowserControlService(new ElectronBrowserControlService());
  registerNotificationService(new ElectronNotificationService());

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

  // start services watcher
  startServicesWatcher();

  // start tracks watcher
  startTracksWatcher();

  // start track scheduler (cron/window/once)
  initTrackScheduler();

  // start track event processor (consumes events/pending/, triggers matching tracks)
  initTrackEventProcessor();

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

  // start local sites server for iframe dashboards and other mini apps
  initLocalSites().catch((error) => {
    console.error('[LocalSites] Failed to start:', error);
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
  shutdownLocalSites().catch((error) => {
    console.error('[LocalSites] Failed to shut down cleanly:', error);
  });
  shutdownAnalytics().catch((error) => {
    console.error('[Analytics] Failed to flush on quit:', error);
  });
});
