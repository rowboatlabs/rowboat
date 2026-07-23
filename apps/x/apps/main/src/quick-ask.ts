/**
 * Quick-ask bar: a Spotlight-style floating window summoned with a global
 * shortcut (⌥Space) from anywhere — type (or hold Right ⌘ to speak) and the
 * question lands in the current chat; the answer streams back into the bar.
 *
 * The window is created once and shown/hidden on toggle so summoning is
 * instant. It loads the renderer bundle with #quick-ask (see
 * renderer/src/main.tsx) and talks over quickAsk:* channels: submits relay
 * to the app window (which owns the chat), response state relays back here
 * (see the quickAsk handlers in ipc.ts).
 */
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BAR_WIDTH = 640;
const BAR_HEIGHT = 88;
const MAX_HEIGHT = 480;

let quickAskWin: BrowserWindow | null = null;

export function getQuickAskWindow(): BrowserWindow | null {
  return quickAskWin && !quickAskWin.isDestroyed() ? quickAskWin : null;
}

function createWindow(): BrowserWindow {
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const preloadPath = app.isPackaged
    ? path.join(hereDir, '../preload/dist/preload.js')
    : path.join(hereDir, '../../../preload/dist/preload.js');
  const win = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    frame: false,
    resizable: false,
    // Never fullscreenable — see the popout in ipc.ts: windows created while
    // a fullscreen Space is active can otherwise open fullscreen themselves.
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    // NSPanel: the bar must appear over other apps' fullscreen Spaces — the
    // whole point is summoning it from wherever the user is.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    backgroundColor: '#171717',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });
  // Same all-workspaces setup as the call popout: float over fullscreen
  // Spaces too, keeping the Dock icon (skipTransformProcessType).
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // Spotlight behavior: clicking away dismisses the bar.
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) win.hide();
  });
  win.on('closed', () => {
    if (quickAskWin === win) quickAskWin = null;
  });
  if (app.isPackaged) {
    void win.loadURL('app://-/index.html#quick-ask');
  } else {
    void win.loadURL('http://localhost:5173/#quick-ask');
  }
  quickAskWin = win;
  return win;
}

function positionOnActiveDisplay(win: BrowserWindow) {
  // The display the cursor is on — the user summons the bar where they're
  // working, which may not be where the app window lives.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea } = display;
  const [width] = win.getSize();
  win.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + workArea.height * 0.2),
  );
}

export function hideQuickAsk() {
  const win = getQuickAskWindow();
  if (win?.isVisible()) win.hide();
}

export function toggleQuickAsk() {
  let win = getQuickAskWindow();
  if (win?.isVisible()) {
    win.hide();
    return;
  }
  if (!win) win = createWindow();
  positionOnActiveDisplay(win);
  // Unlike the call popout, taking focus is the point — the user is about
  // to type. The renderer focuses its input on window focus.
  win.show();
  win.focus();
}

/** Grow/shrink the bar as the response area appears (renderer-driven). */
export function resizeQuickAsk(height: number) {
  const win = getQuickAskWindow();
  if (!win) return;
  const clamped = Math.max(BAR_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height)));
  const [width] = win.getSize();
  win.setSize(width, clamped);
}

export function initQuickAsk() {
  const ok = globalShortcut.register('Alt+Space', toggleQuickAsk);
  if (!ok) {
    // Another app owns ⌥Space (e.g. an existing launcher) — quick-ask is
    // simply unavailable rather than fighting over the chord.
    console.warn('[quick-ask] failed to register Alt+Space (already taken?)');
  }
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
