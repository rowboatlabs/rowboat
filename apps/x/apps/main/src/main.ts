import { app, BrowserWindow } from "electron";
import path from "node:path";
import { setupIpcHandlers, startRunsWatcher, startWorkspaceWatcher, stopWorkspaceWatcher } from "./ipc.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initPreBuiltRunner } from "@x/core/dist/pre_built/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const preloadPath = path.join(__dirname, "../../preload/dist/preload.js");
console.log("preloadPath", preloadPath);

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

  win.loadURL("http://localhost:5173"); // load the dev server
}

app.whenReady().then(() => {
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