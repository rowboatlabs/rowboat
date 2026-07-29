/**
 * The companion window: ONE always-on-top window that plays both floating
 * roles.
 *
 * - `summoned` (global ⌥⇧Space): Spotlight-style — the real chat composer in
 *   a card at the bottom of a tall transparent frame, bottom-centered on the
 *   cursor's display. Takes focus; blur or Esc dismisses.
 * - `pinned` (a call's floating surface, the old #video-popout pill): shown
 *   for the whole duration of a screen share, top-right of the primary
 *   display. Never steals focus (showInactive), survives blur, draggable.
 *
 * The window is created once and shown/hidden on toggle so summoning is
 * instant. It loads the renderer bundle with #quick-ask (see
 * renderer/src/main.tsx); the renderer swaps layouts on the pushed mode
 * (`quick-ask:mode`). Submits relay to the app window (which owns the chat
 * AND the call engine) over quickAsk:* channels; call state streams in over
 * `video:popout-state` exactly as it did for the old popout window.
 *
 * Summoned geometry: a FIXED tall transparent frame. Only the card at the
 * bottom paints anything — the transparent zone above it exists so in-window
 * popovers (the @-mention list, the model picker, menus) can open upward
 * without being clipped by the window bounds, and so the response panel can
 * grow without any window resizing. A click in the transparent zone
 * dismisses the bar, preserving the click-away feel.
 *
 * Pinned geometry: a compact pill sized to its content (the renderer asks
 * for height changes over video:popoutResize when its response panel
 * opens/folds), like the old popout window.
 */
import { DEV_SERVER_URL } from './dev-server.js';
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CompanionMode = 'hidden' | 'summoned' | 'pinned';

// Design-space dimensions (what the renderer lays out against, in CSS px).
// The summoned frame is deliberately taller than the card: the extra space
// is the invisible stage for popovers and the growing response panel.
const FRAME_WIDTH = 680;
const FRAME_HEIGHT = 560;
// Pinned pill bounds. Height is renderer-driven between base and max
// (video:popoutResize), same contract as the old popout window.
const PINNED_WIDTH = 400;
const PINNED_BASE_HEIGHT = 320;
const PINNED_MAX_HEIGHT = 560;
// Uniform downscale: the window shrinks and the page zooms by the SAME
// factor, so every proportion of the design survives exactly — unlike
// hand-shrinking individual sizes, which broke the alignment.
const SCALE = 0.9;
const scaled = (v: number) => Math.round(v * SCALE);

let quickAskWin: BrowserWindow | null = null;
let mode: CompanionMode = 'hidden';

// Last call state pushed by the app window — replayed when the window
// (re)loads, so the pill never renders from a blank guess.
type PopoutState = {
  ttsState: 'idle' | 'synthesizing' | 'speaking';
  status: 'idle' | 'listening' | 'thinking' | 'speaking' | null;
  cameraOn: boolean;
  micMuted: boolean;
  screenSharing: boolean;
  interimText: string | null;
  pttLocked: boolean;
  responseText: string | null;
  questionText: string | null;
};
let lastPopoutState: PopoutState | null = null;

export function getQuickAskWindow(): BrowserWindow | null {
  return quickAskWin && !quickAskWin.isDestroyed() ? quickAskWin : null;
}

export function getCompanionMode(): CompanionMode {
  return mode;
}

function pushMode(win: BrowserWindow) {
  win.webContents.send('quick-ask:mode', { mode });
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
    // Never fullscreenable — windows created while a fullscreen Space is
    // active can otherwise open fullscreen themselves (the pill swallowing
    // the whole screen).
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    // NSPanel: the window must appear over other apps' fullscreen Spaces —
    // the whole point of both roles is floating over wherever the user is.
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    // The summoned frame is mostly transparent — a native shadow would
    // outline the whole invisible rectangle. Cards draw their own CSS
    // shadows in both modes.
    hasShadow: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  });
  // Float over fullscreen Spaces too, keeping the Dock icon
  // (skipTransformProcessType — without it, visibleOnFullScreen turns the
  // app into a macOS "agent" app while the window exists). macOS concepts —
  // on Windows `alwaysOnTop` alone is the whole story.
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  // Spotlight behavior for the SUMMONED role only: clicking away dismisses.
  // A pinned pill must survive blur — it floats while the user works.
  win.on('blur', () => {
    if (!win.isDestroyed() && win.isVisible() && mode === 'summoned') {
      mode = 'hidden';
      win.hide();
    }
  });
  win.on('closed', () => {
    if (quickAskWin === win) quickAskWin = null;
  });
  // Zoom factor resets on navigation — apply it once the page is in, and
  // replay the state the renderer needs to pick up where things stand.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(SCALE);
    pushMode(win);
    if (lastPopoutState) {
      win.webContents.send('video:popout-state', lastPopoutState);
    }
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

function positionSummoned(win: BrowserWindow) {
  // The display the cursor is on — the user summons the bar where they're
  // working, which may not be where the app window lives. Bottom-centered,
  // dock-style.
  win.setBounds({
    width: scaled(FRAME_WIDTH),
    height: scaled(FRAME_HEIGHT),
  });
  // The frame is mostly transparent — a native shadow would outline the
  // whole invisible rectangle (the card draws its own CSS shadow).
  win.setHasShadow(false);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea } = display;
  const [width, height] = win.getSize();
  win.setPosition(
    Math.round(workArea.x + (workArea.width - width) / 2),
    Math.round(workArea.y + workArea.height - height - BOTTOM_MARGIN),
  );
}

function positionPinned(win: BrowserWindow) {
  // Top-right of the primary display, like the old popout window.
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = scaled(PINNED_WIDTH);
  win.setBounds({
    x: workArea.x + workArea.width - width - 24,
    y: workArea.y + 24,
    width,
    height: scaled(PINNED_BASE_HEIGHT),
  });
  // The pill fills its window, so the native shadow tracks a real edge here
  // (unlike the summoned frame, where it would outline transparency).
  win.setHasShadow(true);
}

export function hideQuickAsk() {
  const win = getQuickAskWindow();
  // Never let a stray hide take down a live call surface.
  if (mode === 'pinned') return;
  mode = 'hidden';
  if (win?.isVisible()) win.hide();
}

export function toggleQuickAsk() {
  let win = getQuickAskWindow();
  // While a call pill is up, the shortcut focuses it (the composer is right
  // there) instead of toggling a second surface into existence.
  if (mode === 'pinned' && win) {
    win.focus();
    return;
  }
  if (win?.isVisible()) {
    mode = 'hidden';
    win.hide();
    return;
  }
  if (!win) win = createWindow();
  mode = 'summoned';
  positionSummoned(win);
  pushMode(win);
  // Unlike the pinned pill, taking focus is the point — the user is about
  // to type. The renderer focuses its input on window focus.
  win.show();
  win.focus();
}

/** Show (never hide) — the discoverability toast's "Try it" action. */
export function showQuickAsk() {
  if (mode === 'pinned') return;
  if (!getQuickAskWindow()?.isVisible()) toggleQuickAsk();
}

/**
 * Enter/leave the pinned role — the call engine's floating surface
 * (callSurface === 'popout' in the app window). Replaces the old separate
 * #video-popout window wholesale.
 */
export function setCompanionPinned(pinned: boolean) {
  if (pinned) {
    let win = getQuickAskWindow();
    if (!win) win = createWindow();
    mode = 'pinned';
    positionPinned(win);
    pushMode(win);
    // showInactive: appearing must not steal focus from the app the user
    // switched to — that would be a focus grab mid-work.
    if (!win.isVisible()) win.showInactive();
  } else {
    if (mode !== 'pinned') return;
    mode = 'hidden';
    const win = getQuickAskWindow();
    if (win) {
      pushMode(win);
      if (win.isVisible()) win.hide();
    }
  }
}

/** Renderer-driven pill height (response panel open/folded). Pinned only. */
export function resizeCompanionPinned(height: number) {
  const win = getQuickAskWindow();
  if (!win || mode !== 'pinned') return;
  const clamped = scaled(Math.max(PINNED_BASE_HEIGHT, Math.min(PINNED_MAX_HEIGHT, Math.round(height))));
  const bounds = win.getBounds();
  win.setBounds({ ...bounds, height: clamped });
}

/** Cache + forward the app window's call-state push (video:popoutState). */
export function pushPopoutState(state: PopoutState) {
  lastPopoutState = state;
  getQuickAskWindow()?.webContents.send('video:popout-state', state);
}

export function getPopoutState(): PopoutState | null {
  return lastPopoutState;
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
