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
const FRAME_WIDTH = 800;
const FRAME_HEIGHT = 560;
// Pinned pill bounds. Height is renderer-driven between base and max
// (video:popoutResize), same contract as the old popout window.
const PINNED_WIDTH = 400;
const PINNED_BASE_HEIGHT = 320;
const PINNED_MAX_HEIGHT = 560;
// Tucked presentation of the pinned role: just the mascot + status chip +
// caption, everything else on hover.
const TUCKED_WIDTH = 250;
const TUCKED_HEIGHT = 250;
// Uniform downscale: the window shrinks and the page zooms by the SAME
// factor, so every proportion of the design survives exactly — unlike
// hand-shrinking individual sizes, which broke the alignment.
const SCALE = 0.9;
const scaled = (v: number) => Math.round(v * SCALE);

let quickAskWin: BrowserWindow | null = null;
let mode: CompanionMode = 'hidden';
// Pinned presentation: full pill vs tucked down to just the mascot.
let pinnedCollapsed = false;
// Where this pin came from: 'bar' (the summoned card's tuck handle) or
// 'pill' (the call engine's normal floating surface). Untuck returns the
// user to the surface they tucked FROM — a voice call entered via the bar
// expands back to the bar-style text card, not the video pill.
let tuckOrigin: 'bar' | 'pill' = 'pill';
// The expanded surface currently applied to the window geometry (so a
// device flip mid-call can morph card ⇄ pill in place).
let appliedExpandedSurface: 'card' | 'pill' = 'pill';
// A tuck was requested from the summoned bar: the NEXT pin starts collapsed,
// placed near where the bar's mascot stood (bottom of the cursor's display)
// instead of the pill's canonical top-right. Time-boxed so a tuck the app
// declined (voice not configured, race) can't leak into an unrelated call.
// `tuckPendingExpand` flips the landing to the EXPANDED text card instead —
// the app's "pop this chat out" gesture, where the user was reading text.
let tuckPendingAt = 0;
let tuckPendingExpand = false;

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

export function isPinnedCollapsed(): boolean {
  return pinnedCollapsed;
}

export function markTuckPending(expand = false) {
  tuckPendingAt = Date.now();
  tuckPendingExpand = expand;
}

/**
 * Pop the app's active chat out into the companion. Already pinned: just
 * expand/focus (the chat is the active tab — the destination chip already
 * tracks it). Otherwise arm an EXPANDED-card landing and let the caller
 * relay the tuck to the app (which starts the voice session or falls back
 * to the plain summoned card when voice isn't configured).
 */
export function popOutCompanion(): boolean {
  const win = getQuickAskWindow();
  if (mode === 'pinned' && win) {
    if (pinnedCollapsed) setPinnedCollapsed(false);
    win.focus();
    return true;
  }
  markTuckPending(true);
  return false;
}

/**
 * Which surface the pinned role expands to. Bar-originated sessions go back
 * to the bar-style text card; only a live CAMERA forces the pill — a screen
 * share shows no pixels in the pill either (just the consent badge, which
 * the card's strip carries too), so sharing must never hijack the text
 * pull-out into a video-call surface.
 */
export function getExpandedSurface(): 'card' | 'pill' {
  const s = lastPopoutState;
  return tuckOrigin === 'bar' && !s?.cameraOn ? 'card' : 'pill';
}

function pushMode(win: BrowserWindow) {
  win.webContents.send('quick-ask:mode', {
    mode,
    collapsed: pinnedCollapsed,
    surface: getExpandedSurface(),
  });
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
  // Spotlight behavior: clicking away dismisses the summoned bar. Call
  // surfaces survive blur — but the expanded CARD of a voice call is big
  // and Spotlight-like, so blur tucks it back to the mascot (the call keeps
  // going; only the text gets out of the way). The pill just persists.
  win.on('blur', () => {
    if (win.isDestroyed() || !win.isVisible()) return;
    if (mode === 'summoned') {
      mode = 'hidden';
      win.hide();
    } else if (mode === 'pinned' && !pinnedCollapsed && appliedExpandedSurface === 'card') {
      setPinnedCollapsed(true);
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
    if (lastChatContext) {
      win.webContents.send('quick-ask:chat-context', lastChatContext);
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
  // No native shadow here either: on a TRANSPARENT window macOS keeps a
  // stale shadow for the previous shape after bounds changes (ghost grey
  // outlines hugging old edges — the artifact the old bar fought with
  // invalidateShadow). The pill's hairline ring is its edge treatment.
  win.setHasShadow(false);
}

export function hideQuickAsk() {
  const win = getQuickAskWindow();
  // Never let a stray hide take down a live call surface.
  if (mode === 'pinned') return;
  mode = 'hidden';
  if (win?.isVisible()) win.hide();
}

// Duplicated from ipc.ts (importing it would be a cycle): the hashless
// window is the real app; utility windows all load hash routes.
function findAppWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => {
    if (w.isDestroyed()) return false;
    const url = w.webContents.getURL();
    const isApp = url.startsWith('app://') || url.startsWith('http://localhost');
    return isApp && !url.includes('#');
  });
}

export function toggleQuickAsk(viaShortcut = true) {
  const win = getQuickAskWindow();
  // While a call pill is up, the shortcut brings the text back — expanding
  // a tucked mascot and focusing — instead of toggling a second surface
  // into existence.
  if (mode === 'pinned' && win) {
    if (pinnedCollapsed) setPinnedCollapsed(false);
    win.focus();
    return;
  }
  if (win?.isVisible()) {
    mode = 'hidden';
    win.hide();
    return;
  }
  // VOICE-FIRST: the shortcut summons the mascot on a live voice session —
  // the same relay as the card's tuck handle (the app starts the
  // voice-preset call, and this window pins tucked near the cursor). The
  // text card is the FALLBACK: programmatic shows (the toast), no app
  // window to relay to, or the app declining because voice isn't
  // configured (it calls quickAsk:show, which lands in the card path).
  if (viaShortcut) {
    const appWin = findAppWindow();
    if (appWin) {
      markTuckPending();
      appWin.webContents.send('quick-ask:tuck', null);
      return;
    }
  }
  showSummonedCard(viaShortcut);
}

function showSummonedCard(viaShortcut: boolean) {
  // A voice summon that fell back here must not leave its tuck hint armed —
  // the next unrelated call would start collapsed.
  tuckPendingAt = 0;
  let win = getQuickAskWindow();
  if (!win) win = createWindow();
  mode = 'summoned';
  positionSummoned(win);
  pushMode(win);
  // Unlike the pinned pill, taking focus is the point — the user is about
  // to type. The renderer focuses its input on window focus.
  win.show();
  win.focus();
  // Hold-to-talk: a chord summon starts capturing immediately (the renderer
  // detects the release once it has focus). Skip on first-ever creation —
  // the page is still loading, and by the time it's up the chord is long
  // released.
  if (!win.webContents.isLoading()) {
    win.webContents.send('quick-ask:summoned', { viaShortcut });
  }
}

/** Show (never hide) — the discoverability toast's "Try it" action. */
export function showQuickAsk() {
  if (mode === 'pinned') return;
  if (!getQuickAskWindow()?.isVisible()) toggleQuickAsk(false);
}

/**
 * Enter/leave the pinned role — the call engine's floating surface
 * (callSurface === 'popout' in the app window). Replaces the old separate
 * #video-popout window wholesale.
 */
export function setCompanionPinned(pinned: boolean) {
  if (pinned) {
    if (mode === 'pinned') {
      tuckPendingAt = 0;
      return;
    }
    let win = getQuickAskWindow();
    if (!win) win = createWindow();
    const fromTuck = Date.now() - tuckPendingAt < 5000;
    const expandFromTuck = fromTuck && tuckPendingExpand;
    tuckPendingAt = 0;
    tuckPendingExpand = false;
    mode = 'pinned';
    tuckOrigin = fromTuck ? 'bar' : 'pill';
    if (expandFromTuck) {
      // Pop-out landing: the user was READING this chat in the app — arrive
      // on the expanded text card, focused and ready to type.
      pinnedCollapsed = false;
      applyExpandedSurface(win, 'card');
    } else if (fromTuck) {
      pinnedCollapsed = true;
      positionTucked(win, screen.getDisplayNearestPoint(screen.getCursorScreenPoint()));
    } else {
      pinnedCollapsed = false;
      positionPinned(win);
      appliedExpandedSurface = 'pill';
    }
    pushMode(win);
    if (expandFromTuck) {
      if (!win.isVisible()) win.show();
      win.focus();
    } else if (!win.isVisible()) {
      // showInactive: appearing must not steal focus from the app the user
      // switched to — that would be a focus grab mid-work.
      win.showInactive();
    }
  } else {
    if (mode !== 'pinned') return;
    mode = 'hidden';
    pinnedCollapsed = false;
    tuckOrigin = 'pill';
    tuckPendingAt = 0;
    const win = getQuickAskWindow();
    if (win) {
      pushMode(win);
      if (win.isVisible()) win.hide();
    }
  }
}

/**
 * Tucked-mascot ⇄ expanded presentation of the pinned role. The expanded
 * surface is whatever the user tucked FROM: the pill resizes in place
 * (preserving the window's right edge and whichever vertical edge hugs the
 * nearer screen edge); the bar-style card goes back to the bar's canonical
 * spot — bottom-center of the window's display — and takes focus, because
 * asking for the text back means the user is about to read or type.
 */
export function setPinnedCollapsed(collapsed: boolean) {
  const win = getQuickAskWindow();
  if (!win || mode !== 'pinned' || pinnedCollapsed === collapsed) return;
  pinnedCollapsed = collapsed;
  if (collapsed) {
    if (appliedExpandedSurface === 'card') {
      // The wide card's edges mean nothing once it's gone — tuck to the
      // mascot's canonical corner on this display.
      positionTucked(win, screen.getDisplayMatching(win.getBounds()));
    } else {
      const b = win.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      const w = scaled(TUCKED_WIDTH);
      const h = scaled(TUCKED_HEIGHT);
      const inTopHalf = b.y + b.height / 2 < wa.y + wa.height / 2;
      let x = b.x + b.width - w;
      let y = inTopHalf ? b.y : b.y + b.height - h;
      x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
      y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
      win.setBounds({ x, y, width: w, height: h });
    }
    pushMode(win);
    return;
  }
  applyExpandedSurface(win, getExpandedSurface());
  pushMode(win);
  if (appliedExpandedSurface === 'card') win.focus();
}

function applyExpandedSurface(win: BrowserWindow, surface: 'card' | 'pill') {
  appliedExpandedSurface = surface;
  if (surface === 'card') {
    // The bar's geometry: tall transparent frame, bottom-center of the
    // display the window is on.
    const wa = screen.getDisplayMatching(win.getBounds()).workArea;
    const w = scaled(FRAME_WIDTH);
    const h = scaled(FRAME_HEIGHT);
    win.setBounds({
      x: Math.round(wa.x + (wa.width - w) / 2),
      y: Math.round(wa.y + wa.height - h - BOTTOM_MARGIN),
      width: w,
      height: h,
    });
    win.setHasShadow(false);
    return;
  }
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const w = scaled(PINNED_WIDTH);
  const h = scaled(PINNED_BASE_HEIGHT);
  const inTopHalf = b.y + b.height / 2 < wa.y + wa.height / 2;
  let x = b.x + b.width - w;
  let y = inTopHalf ? b.y : b.y + b.height - h;
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
  win.setBounds({ x, y, width: w, height: h });
  win.setHasShadow(false);
}

function positionTucked(win: BrowserWindow, display: Electron.Display) {
  // The mascot's canonical corner: bottom right of the given display, near
  // where it stood beside the card — never teleporting across screens.
  const wa = display.workArea;
  const w = scaled(TUCKED_WIDTH);
  const h = scaled(TUCKED_HEIGHT);
  win.setBounds({
    x: wa.x + wa.width - w - 24,
    y: wa.y + wa.height - h - 48,
    width: w,
    height: h,
  });
  win.setHasShadow(false);
}

/** Renderer-driven pill height (response panel open/folded). Pinned only. */
export function resizeCompanionPinned(height: number) {
  const win = getQuickAskWindow();
  if (!win || mode !== 'pinned' || pinnedCollapsed) return;
  const clamped = scaled(Math.max(PINNED_BASE_HEIGHT, Math.min(PINNED_MAX_HEIGHT, Math.round(height))));
  const bounds = win.getBounds();
  win.setBounds({ ...bounds, height: clamped });
}

/** Cache + forward the app window's call-state push (video:popoutState). */
export function pushPopoutState(state: PopoutState) {
  lastPopoutState = state;
  const win = getQuickAskWindow();
  if (!win) return;
  win.webContents.send('video:popout-state', state);
  // A device flip mid-call (camera/share toggled) can change which surface
  // the expanded role needs — morph card ⇄ pill in place.
  if (mode === 'pinned' && !pinnedCollapsed) {
    const surface = getExpandedSurface();
    if (surface !== appliedExpandedSurface) {
      applyExpandedSurface(win, surface);
      pushMode(win);
    }
  }
}

export function getPopoutState(): PopoutState | null {
  return lastPopoutState;
}

// Destination-chat context (title chip + recents switcher), pushed by the
// app window — cached so a freshly loaded bar renders the right chip.
type ChatContext = {
  activeRunId: string | null;
  activeTitle: string | null;
  recent: { id: string; title: string }[];
};
let lastChatContext: ChatContext | null = null;

export function pushChatContext(ctx: ChatContext) {
  lastChatContext = ctx;
  getQuickAskWindow()?.webContents.send('quick-ask:chat-context', ctx);
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
