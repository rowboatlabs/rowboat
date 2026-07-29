/**
 * Quick-ask bar: a Spotlight-style floating window summoned with a global
 * shortcut (⌥⇧Space) from anywhere — the REAL chat composer in a floating
 * card. Questions land in the current chat; the answer streams back into the
 * bar's response panel.
 *
 * The window is created once and shown/hidden on toggle so summoning is
 * instant. It loads the renderer bundle with #quick-ask (see
 * renderer/src/main.tsx) and talks over quickAsk:* channels: submits relay
 * to the app window (which owns the chat), response state relays back here
 * (see the quickAsk handlers in ipc.ts).
 *
 * Geometry: the window is a FIXED tall transparent frame. Only the card at
 * the bottom paints anything — the transparent zone above it exists so
 * in-window popovers (the @-mention list, the model picker, menus) can open
 * upward without being clipped by the window bounds, and so the response
 * panel can grow without any window resizing. A click in the transparent
 * zone dismisses the bar, preserving the click-away feel.
 */
import { DEV_SERVER_URL } from './dev-server.js';
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Design-space dimensions (what the renderer lays out against, in CSS px).
// The frame is deliberately taller than the card: the extra space is the
// invisible stage for popovers and the growing response panel.
const FRAME_WIDTH = 680;
const FRAME_HEIGHT = 560;
// Uniform downscale: the window shrinks and the page zooms by the SAME
// factor, so every proportion of the design survives exactly — unlike
// hand-shrinking individual sizes, which broke the alignment.
const SCALE = 0.9;
const scaled = (v: number) => Math.round(v * SCALE);

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
    width: scaled(FRAME_WIDTH),
    height: scaled(FRAME_HEIGHT),
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
    // The frame is mostly transparent — a native shadow would outline the
    // whole invisible rectangle. The card draws its own CSS shadow instead.
    hasShadow: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });
  // Same all-workspaces setup as the call popout: float over fullscreen
  // Spaces too, keeping the Dock icon (skipTransformProcessType). macOS
  // concepts — on Windows `alwaysOnTop` alone is the whole story (no
  // Spaces), and the options object is meaningless there.
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  // Spotlight behavior: clicking away dismisses the bar.
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible()) win.hide();
  });
  win.on('closed', () => {
    if (quickAskWin === win) quickAskWin = null;
  });
  // Zoom factor resets on navigation — apply it once the page is in.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(SCALE);
  });
  if (app.isPackaged) {
    void win.loadURL('app://-/index.html#quick-ask');
  } else {
    void win.loadURL(`${DEV_SERVER_URL}/#quick-ask`);
  }
  quickAskWin = win;
  return win;
}

// Gap between the CARD's bottom edge (= the window's bottom edge, since the
// card is bottom-anchored in the frame) and the bottom of the work area.
const BOTTOM_MARGIN = 96;

function positionOnActiveDisplay(win: BrowserWindow) {
  // The display the cursor is on — the user summons the bar where they're
  // working, which may not be where the app window lives. Bottom-centered,
  // dock-style.
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea } = display;
  const [width, height] = win.getSize();
  win.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + workArea.height - height - BOTTOM_MARGIN),
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

/** Show (never hide) — the discoverability toast's "Try it" action. */
export function showQuickAsk() {
  if (!getQuickAskWindow()?.isVisible()) toggleQuickAsk();
}

export function initQuickAsk() {
  // ⌥⇧Space: plain ⌥Space is the most contested launcher chord on macOS
  // (Raycast, ChatGPT desktop, …) — registering it would silently lose or,
  // worse, double-fire alongside whatever owns it.
  const ok = globalShortcut.register('Alt+Shift+Space', toggleQuickAsk);
  if (!ok) {
    // Another app owns the chord — quick-ask is simply unavailable rather
    // than fighting over it.
    console.warn('[quick-ask] failed to register Alt+Shift+Space (already taken?)');
  }
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
