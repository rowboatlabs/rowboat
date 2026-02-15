import { app, BrowserWindow, protocol, net, shell } from "electron";
import path from "node:path";
import {
  setupIpcHandlers,
  startRunsWatcher,
  startServicesWatcher,
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
import { init as initPreBuiltRunner } from "@x/core/dist/pre_built/runner.js";
import { init as initAgentRunner } from "@x/core/dist/agent-schedule/runner.js";
import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import started from "electron-squirrel-startup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// run this as early in the main process as possible
if (started) app.quit();

// In dev mode, Electron sets process.defaultApp = true. This is more reliable
// than app.isPackaged because the esbuild-bundled .cjs can confuse isPackaged.
const isDev = !!(process as any).defaultApp;

// Path resolution differs between development and production:
const preloadPath = isDev
  ? path.join(__dirname, "../../../preload/dist/preload.js")
  : path.join(__dirname, "../preload/dist/preload.js");
console.log("preloadPath", preloadPath);

const rendererPath = isDev
  ? path.join(__dirname, "../../../renderer/dist") // Development
  : path.join(__dirname, "../renderer/dist"); // Production
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true, // Show immediately to prevent invisible window issues
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

  // Show window when content is ready to prevent blank screen
  win.once("ready-to-show", () => {
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

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadURL("app://-/index.html");
  }
}

app.whenReady().then(async () => {
  // Register custom protocol before creating window (for production builds)
  if (!isDev) {
    registerAppProtocol();
  }

  // Initialize auto-updater (only in production)
  if (!isDev) {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "rowboatlabs/rowboat",
      },
      notifyUser: true, // Shows native dialog when update is available
    });
  }

  // Initialize all config files before UI can access them
  await initConfigs();

  setupIpcHandlers();

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

  // start pre-built agent runner
  initPreBuiltRunner();

  // start background agent runner (scheduled agents)
  initAgentRunner();

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
});
