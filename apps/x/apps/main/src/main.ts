import { app, BrowserWindow, protocol, net } from "electron";
import path from "node:path";
import { setupIpcHandlers, startRunsWatcher, startWorkspaceWatcher, stopWorkspaceWatcher } from "./ipc.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initPreBuiltRunner } from "@x/core/dist/pre_built/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path resolution differs between development and production:
// - Development: main.js runs from dist/, preload is at ../../preload/dist/ (sibling dir)
// - Production: main.js runs from .package/dist-bundle/, preload is at ../preload/dist/ (copied into .package/)
const preloadPath = app.isPackaged
  ? path.join(__dirname, "../preload/dist/preload.js")      // Production
  : path.join(__dirname, "../../preload/dist/preload.js");  // Development
console.log("preloadPath", preloadPath);

// Register custom protocol for serving built renderer files in production
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    // Remove 'app://' prefix and get the path
    let urlPath = request.url.slice('app://'.length);
    
    // Remove leading './' if present
    if (urlPath.startsWith('./')) {
      urlPath = urlPath.slice(2);
    }
    
    // Default to index.html for root or SPA routes (no file extension)
    if (!urlPath || urlPath === '/' || !path.extname(urlPath)) {
      urlPath = 'index.html';
    }
    
    // Resolve to the renderer dist directory
    // - Development: main.js at dist/, renderer at ../../renderer/dist/ (sibling dir)
    // - Production: main.js at .package/dist-bundle/, renderer at ../renderer/dist/ (copied into .package/)
    const rendererDistPath = app.isPackaged
      ? path.join(__dirname, '../renderer/dist')
      : path.join(__dirname, '../../renderer/dist');
    const filePath = path.join(rendererDistPath, urlPath);
    
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // IMPORTANT: keep Node out of renderer
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });

  if (app.isPackaged) {
    // Production: load from custom protocol (serves built renderer files)
    win.loadURL('app://./');
  } else {
    // Development: load from Vite dev server
    win.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(() => {
  // Register custom protocol before creating window (for production builds)
  registerAppProtocol();
  
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

  app.on('activate', () => {
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
});