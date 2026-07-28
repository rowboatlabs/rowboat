/**
 * Quick-ask bar: a Spotlight-style floating window summoned with a global
 * shortcut (⌥⇧Space) from anywhere — type (or hold Right ⌘ to speak) and the
 * question lands in the current chat; the answer streams back into the bar.
 *
 * The window is created once and shown/hidden on toggle so summoning is
 * instant. It loads the renderer bundle with #quick-ask (see
 * renderer/src/main.tsx) and talks over quickAsk:* channels: submits relay
 * to the app window (which owns the chat), response state relays back here
 * (see the quickAsk handlers in ipc.ts).
 */
import { DEV_SERVER_URL } from './dev-server.js';
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Design-space dimensions (what the renderer lays out against, in CSS px).
const BAR_WIDTH = 640;
const BAR_HEIGHT = 88;
const MAX_HEIGHT = 480;
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
    width: scaled(BAR_WIDTH),
    height: scaled(BAR_HEIGHT),
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
    // Transparent window + CSS border-radius on the root gives the bar its
    // large rounded corners (the frameless default radius is much tighter).
    transparent: true,
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
  // Zoom factor resets on navigation — apply it once the page is in.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(SCALE);
    void applyLiquidGlass(win);
  });
  if (app.isPackaged) {
    void win.loadURL('app://-/index.html#quick-ask');
  } else {
    void win.loadURL(`${DEV_SERVER_URL}/#quick-ask`);
  }
  quickAskWin = win;
  return win;
}

// Gap between the bar's bottom edge and the bottom of the work area.
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

// --- Liquid Glass (experiment) ---
// Real NSGlassEffectView behind the bar via electron-liquid-glass (macOS
// 26+; safe no-op elsewhere). Loaded lazily: it's a native module, and its
// absence (older macOS, packaged builds that don't stage it) must degrade
// to the solid capsule — the renderer only swaps to a translucent
// background when told the glass actually applied.
async function applyLiquidGlass(win: BrowserWindow) {
  if (process.platform !== 'darwin') return;
  try {
    const { default: liquidGlass } = await import('electron-liquid-glass');
    liquidGlass.addView(win.getNativeWindowHandle(), {
      // Matches the CSS capsule radius (44 design px × 0.9 zoom).
      cornerRadius: 40,
      tintColor: '#1a1b1e33',
    });
    await win.webContents.executeJavaScript(
      "document.documentElement.dataset.liquidGlass = '1'",
      true,
    );
  } catch (err) {
    console.warn('[quick-ask] liquid glass unavailable, keeping solid capsule:', err);
  }
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
  if (process.platform === 'darwin') win.invalidateShadow();
}

/** Show (never hide) — the discoverability toast's "Try it" action. */
export function showQuickAsk() {
  if (!getQuickAskWindow()?.isVisible()) toggleQuickAsk();
}

/**
 * Grow/shrink the bar as the response area appears (renderer-driven).
 * The bar is bottom-anchored, so growth extends UPWARD: the bottom edge
 * stays put and the top rises.
 */
export function resizeQuickAsk(height: number) {
  const win = getQuickAskWindow();
  if (!win) return;
  // The renderer requests design-space heights; the window lives in scaled
  // space.
  const clamped = scaled(Math.max(BAR_HEIGHT, Math.min(MAX_HEIGHT, Math.round(height))));
  const [x, y] = win.getPosition();
  const [width, currentHeight] = win.getSize();
  const bottom = y + currentHeight;
  win.setBounds({ x, y: bottom - clamped, width, height: clamped });
  // Transparent windows keep a stale native shadow for the PREVIOUS shape
  // after a resize (ghost outline hugging the old edges) — recompute it.
  if (process.platform === 'darwin') win.invalidateShadow();
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
