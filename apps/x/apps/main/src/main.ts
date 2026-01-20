import { app, BrowserWindow, protocol, net, shell } from "electron";
import path from "node:path";
import { setupIpcHandlers, startRunsWatcher, startWorkspaceWatcher, stopWorkspaceWatcher } from "./ipc.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { existsSync } from "node:fs";
import { updateElectronApp, UpdateSourceType } from "update-electron-app";
import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initPreBuiltRunner } from "@x/core/dist/pre_built/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// #region agent log
fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:14',message:'__dirname resolved',data:{__dirname,__filename,isPackaged:app.isPackaged},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
// #endregion

// Path resolution differs between development and production:
// - Development: main.js runs from dist/, preload is at ../../preload/dist/ (sibling dir)
// - Production: main.js runs from .package/dist-bundle/, preload is at ../preload/dist/ (copied into .package/)
const preloadPath = app.isPackaged
  ? path.join(__dirname, "../preload/dist/preload.js")      // Production
  : path.join(__dirname, "../../preload/dist/preload.js");  // Development
console.log("preloadPath", preloadPath);

// #region agent log
fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:22',message:'preloadPath computed',data:{preloadPath,exists:existsSync(preloadPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
// #endregion

// Register custom protocol for serving built renderer files in production
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:26',message:'protocol handler called',data:{url:request.url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
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
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:46',message:'renderer path resolution',data:{rendererDistPath,filePath,urlPath,exists:existsSync(filePath),rendererDistExists:existsSync(rendererDistPath)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      // IMPORTANT: keep Node out of renderer
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });

  // Open external links in system browser (not sandboxed Electron window)
  // This handles window.open() and target="_blank" links
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open all URLs in system browser
    shell.openExternal(url);
    return { action: 'deny' }; // Prevent Electron from opening a new window
  });

  // Handle navigation to external URLs (e.g., clicking a link without target="_blank")
  win.webContents.on('will-navigate', (event, url) => {
    // Allow internal navigation (app protocol or dev server)
    const isInternal = url.startsWith('app://') || url.startsWith('http://localhost:5173');
    if (!isInternal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // #region agent log
  const loadURL = app.isPackaged ? 'app://./' : 'http://localhost:5173';
  fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:65',message:'createWindow called',data:{isPackaged:app.isPackaged,loadURL,preloadPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
  // #endregion

  if (app.isPackaged) {
    // Production: load from custom protocol (serves built renderer files)
    win.loadURL('app://./');
    
    // #region agent log
    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:69',message:'window load failed',data:{errorCode,errorDescription,validatedURL},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    });
    win.webContents.on('did-finish-load', () => {
      fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:72',message:'window load finished',data:{url:win.webContents.getURL()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    });
    // #endregion
  } else {
    // Development: load from Vite dev server
    win.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(() => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:74',message:'app.whenReady triggered',data:{isPackaged:app.isPackaged},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Register custom protocol before creating window (for production builds)
  registerAppProtocol();
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/dd33b297-24f6-4846-82f9-02599308a13a',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.ts:77',message:'protocol registered',data:{isPackaged:app.isPackaged},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  
  // Initialize auto-updater (only in production)
  if (app.isPackaged) {
    updateElectronApp({
      updateSource: {
        type: UpdateSourceType.StaticStorage,
        baseUrl: `https://rowboat-desktop-app-releases.s3.amazonaws.com/releases/${process.platform}/${process.arch}`
      },
      notifyUser: true  // Shows native dialog when update is available
    });
  }
  
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