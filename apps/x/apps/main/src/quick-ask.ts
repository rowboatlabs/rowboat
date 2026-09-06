/**
 * The companion window: ONE always-on-top window playing ONE floating role —
 * the SKIPPER, the hover companion.
 *
 * `pinned`: a live voice session's floating surface. The Skipper card —
 * control strip + composer, one corner-anchored draggable unit (text
 * visible by default, foldable down to the mini call pill — folding never
 * moves the corner). A live CAMERA swaps the card for the pill (top-right),
 * where the self-view lives. Both survive blur — this is a companion the
 * user works next to.
 *
 * `hidden`: no session. Nothing else exists.
 *
 * (Retired: the `summoned` role — a standalone Spotlight-style ask bar with
 * its own answer panel, dictation and voice/share toggles. It was only ever
 * a fallback surface, and every "hover mode is glitchy" report came down to
 * that bar appearing where the Skipper belonged. ⌥⇧Space now has exactly one
 * outcome, so there is no second layout to flash, race, or get stuck in.)
 *
 * The window is created once and shown/hidden so summoning is instant. It
 * loads the renderer bundle with #quick-ask (see renderer/src/main.tsx);
 * the renderer renders the presentation pushed over `quick-ask:mode`.
 * Submits relay to the app window (which owns the chat AND the call engine)
 * over quickAsk:* channels; call state streams in over `video:popout-state`
 * exactly as it did for the old popout window.
 *
 * ⌥⇧Space (and the tray item) ALWAYS means "summon my companion": main
 * relays to the app window, which starts the voice session and pins this
 * window. While the Skipper is up the chord folds/unfolds its text panel.
 *
 * Geometry: a transparent frame with the card bottom-anchored, its
 * bottom-right at the anchor corner. The zone above the card is invisible
 * stage — it
 * exists so in-window popovers (the @-mention list, the model picker, menus)
 * can open upward without being clipped, and so the text panel can grow
 * without any window resizing. The pill is sized to its content (the
 * renderer asks for height changes over video:popoutResize).
 *
 * Reveal protocol: every `quick-ask:mode` push carries a sequence number and
 * the renderer acks it (`quickAsk:modeApplied`) once that presentation is
 * PAINTED. The window is revealed (opacity 0 → 1, focus) only after the ack,
 * so a summon never shows a half-built or stale layout.
 */
import { DEV_SERVER_URL } from './dev-server.js';
import { app, BrowserWindow, globalShortcut, screen } from 'electron';
import { loadAppSettings, saveAppSettings } from '@x/core/dist/config/app_settings.js';
import { quickAskShortcut } from '@x/shared';

const { DEFAULT_QUICK_ASK_SHORTCUT, normalizeShortcut, isSystemReservedShortcut } = quickAskShortcut;
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type CompanionMode = 'hidden' | 'pinned';

// Design-space dimensions (what the renderer lays out against, in CSS px).
// Pinned pill bounds. Height is renderer-driven between base and max
// (video:popoutResize), same contract as the old popout window.
const PINNED_WIDTH = 400;
const PINNED_BASE_HEIGHT = 320;
const PINNED_MAX_HEIGHT = 560;
// Tucked presentation of the pinned role: the mini call pill — a caption
// line over one row of logo · status lane · share · talk · end.
const TUCKED_WIDTH = 380;
const TUCKED_HEIGHT = 180;
// The Skipper card: control strip + text panel + composer, one unit. It
// hugs a corner, with a tall transparent stage above the card for popovers
// and panel growth.
const SKIPPER_FRAME_WIDTH = 560;
const SKIPPER_FRAME_HEIGHT = 560;
// Uniform downscale: the window shrinks and the page zooms by the SAME
// factor, so every proportion of the design survives exactly — unlike
// hand-shrinking individual sizes, which broke the alignment.
const SCALE = 0.9;
const scaled = (v: number) => Math.round(v * SCALE);

let quickAskWin: BrowserWindow | null = null;
let mode: CompanionMode = 'hidden';
// Role transitions are the breadcrumbs every "the companion vanished /
// flashed / never came" report needs — one line each, nothing per-frame.
function setMode(next: CompanionMode, why: string) {
  if (next === mode) return;
  console.log(`[companion] ${mode} → ${next} (${why})`);
  mode = next;
}
// Pinned presentation: full surface vs tucked down to just the mascot.
let pinnedCollapsed = false;
// The expanded surface currently applied to the window geometry (so a
// device flip mid-call can morph card ⇄ pill in place).
let appliedExpandedSurface: 'card' | 'pill' = 'pill';
// A hover summon (⌥⇧Space, the tray item, or the composer's call button
// relay) is in flight: the NEXT pin gets focus (the user just asked for
// their companion), and if no pin arrives shortly the text card falls back
// so the shortcut is never a silent no-op. Time-boxed so a stale summon
// can't leak into an unrelated call.
let summonPendingAt = 0;
// Watchdog for an unanswered summon: the relay can be lost if the app
// window is mid-reload or was just recreated. Cancelled the moment the app
// ACKS (it may then take seconds to acquire devices — that must not
// re-trigger anything).
let summonWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
let summonRetried = false;
// When the last tuck relay went out and has not been acked yet (0 = none).
// A relay can be lost when the app window is still loading (login-hidden
// start, or the window being recreated because the user had closed it) —
// the app's `quickAsk:appReady` handshake re-sends a recent unacked one.
let summonRelayAt = 0;
const SUMMON_RELAY_RETRY_WINDOW_MS = 15_000;
// How long a relay may go unanswered before it is re-sent: short when an
// app window is up (the ack is synchronous on its side), longer while the
// app window itself is booting.
const SUMMON_WATCHDOG_MS = 1500;
const SUMMON_WATCHDOG_APP_BOOT_MS = 8000;
// Provided by main.ts: (re)create the app window hidden when a summon finds
// none — the user closed it, but "Quick Ask from anywhere" must still work.
let ensureAppWindow: (() => void) | null = null;

function clearSummonWatchdog() {
  if (summonWatchdogTimer) {
    clearTimeout(summonWatchdogTimer);
    summonWatchdogTimer = null;
  }
}

function armSummonWatchdog(ms: number) {
  clearSummonWatchdog();
  summonWatchdogTimer = setTimeout(() => {
    summonWatchdogTimer = null;
    // Landed while we waited — nothing to do.
    if (mode === 'pinned') return;
    if (!summonRetried) {
      // One re-send: the app window was probably mid-reload when the first
      // relay went out (its own `quickAsk:appReady` covers the common case;
      // this covers a reload that raced past it).
      relaySummon({ retry: true });
      return;
    }
    console.warn('[companion] summon went unanswered — the app window never started a session');
  }, ms);
}

/** The app window acknowledged a tuck relay and is starting the session. */
export function ackSummon() {
  clearSummonWatchdog();
  summonRelayAt = 0;
  summonRetried = false;
}

/**
 * The app window's renderer registered its hover relay listener. A summon
 * that went out while it was loading (or before it existed) is delivered
 * now — the shortcut must never be a silent no-op just because the app
 * window was closed or still booting.
 */
export function onAppReady() {
  if (summonRelayAt && Date.now() - summonRelayAt < SUMMON_RELAY_RETRY_WINDOW_MS) {
    relaySummon();
  }
}

/**
 * The app window is gone. A live call dies with it (the app owns the call
 * engine), so a pinned companion must not linger as a dead surface — and
 * its cached call state must not leak into the next session.
 */
export function onAppWindowClosed() {
  lastPopoutState = null;
  if (mode === 'pinned') setCompanionPinned(false);
}

// The Skipper's anchor: the bottom-right corner of the window — where the
// card (and, folded, the mini pill) sits. The user can drag the Skipper
// anywhere; collapsing and expanding the text panel both keep this corner
// fixed, so the dock never jumps — the panel folds toward it and unfolds
// from it. Updated from user drags (the 'move' listener); programmatic
// setBounds are guarded out.
let skipperCorner: { x: number; y: number } | null = null;
let applyingBounds = false;

// --- Drag cursor ---
// The card and the mascot are drag handles, and a handle should say so under
// the hand: grab at rest, GRABBING while it moves. The renderer cannot tell
// on its own — a drag region is native (HTCAPTION on Windows, a layered view
// on macOS), so no mousedown ever reaches the page and `:active` stays false.
// Main owns the one witness that always fires — its own 'move' — and pushes
// the edges of a drag burst: true on the first move, false once the moves
// stop. The tail is short enough not to linger after the button is released
// and long enough to survive the gaps between frames of a slow drag.
const DRAG_IDLE_MS = 180;
let dragging = false;
let dragIdleTimer: ReturnType<typeof setTimeout> | null = null;

function markDragging(win: BrowserWindow) {
  if (!dragging) {
    dragging = true;
    win.webContents.send('quick-ask:dragging', { dragging: true });
  }
  if (dragIdleTimer) clearTimeout(dragIdleTimer);
  dragIdleTimer = setTimeout(() => {
    dragIdleTimer = null;
    dragging = false;
    if (!win.isDestroyed()) win.webContents.send('quick-ask:dragging', { dragging: false });
  }, DRAG_IDLE_MS);
}

// --- Click-through ---
// The frame is far bigger than anything it paints: the card sits at the
// bottom with a tall transparent stage above it (so popovers open upward
// without resizing), and the tucked Skipper is just the mascot in that same
// frame. Transparency is only PAINT — macOS routes a click to the topmost
// window by its RECT, not by pixel alpha — so without this the invisible
// stage swallowed every click that landed on it: a ~500px square of dead
// desktop around the companion. The window is created click-through and the
// renderer flips it solid while the cursor is over something actually
// painted (quickAsk:setInteractive), using `forward` so mouse MOVES keep
// arriving while it is click-through — that is what makes the flip
// possible.
let companionInteractive = false;

function applyInteractive(win: BrowserWindow, next: boolean) {
  if (next === companionInteractive) return;
  companionInteractive = next;
  win.setIgnoreMouseEvents(!next, { forward: true });
}

/**
 * The renderer's hit-test verdict: is the cursor over painted UI? Only a
 * pinned companion may hold the cursor — anything else re-arms
 * click-through, so a stale hover (window hidden mid-move, renderer
 * reloaded) can never leave a dead rectangle behind.
 */
export function setCompanionInteractive(interactive: boolean) {
  const win = getQuickAskWindow();
  if (!win) return;
  applyInteractive(win, interactive && mode === 'pinned');
}

/** Re-arm click-through (leaving the pinned role, window going away). */
function releaseMouse() {
  const win = getQuickAskWindow();
  if (win) applyInteractive(win, false);
}

// Where the cursor is, polled from the OS while the companion is up.
//
// Mouse EVENTS are not a reliable witness for this: on macOS a
// `-webkit-app-region: drag` area is a native view layered over the page, so
// moves across it never reach the renderer — and the mascot is exactly that
// area (it is the drag handle). Driven by events alone the mascot would stay
// click-through: neither clickable nor draggable, the one thing the user
// reaches for most. The OS always knows where the pointer is, so main asks
// it and hands the point to the renderer, which is the only side that knows
// whether that point is over paint.
let cursorWatch: ReturnType<typeof setInterval> | null = null;
let cursorWasInside = false;
// Fast enough that the window is always solid by the time a hand that has
// arrived somewhere presses the button, slow enough to be free.
const CURSOR_WATCH_MS = 40;

function pollCursor() {
  const win = getQuickAskWindow();
  if (!win || mode !== 'pinned') {
    // The role is gone — the belt for the braces in setCompanionPinned.
    // This is the ONLY place main decides the flag on its own; everywhere
    // else the renderer is the single authority, so its cached verdict can
    // never drift out of sync with the window. (Leaving the pinned role
    // also deactivates the hook, which resets that cache.)
    stopCursorWatch();
    releaseMouse();
    return;
  }
  // Hidden: nothing is painted to hit-test and no click can reach the
  // window anyway, so leave the flag alone rather than desyncing the
  // renderer's cache. Keep polling — a re-show picks straight back up.
  if (!win.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  // Outside and already known to be outside: nothing to say. The one push
  // AS it leaves carries an out-of-viewport point, which is how the
  // renderer knows to hand the mouse back.
  if (!inside && !cursorWasInside) return;
  cursorWasInside = inside;
  // Window bounds are DIP; the page is zoomed by SCALE, so its own CSS
  // pixels are DIP / SCALE.
  win.webContents.send('quick-ask:cursor', {
    x: (p.x - b.x) / SCALE,
    y: (p.y - b.y) / SCALE,
  });
}

function startCursorWatch() {
  if (cursorWatch) return;
  cursorWasInside = false;
  cursorWatch = setInterval(pollCursor, CURSOR_WATCH_MS);
}

function stopCursorWatch() {
  if (!cursorWatch) return;
  clearInterval(cursorWatch);
  cursorWatch = null;
  cursorWasInside = false;
}

function setBoundsGuarded(win: BrowserWindow, bounds: Electron.Rectangle) {
  applyingBounds = true;
  win.setBounds(bounds);
  // 'move' fires async after setBounds — release the guard a tick later.
  setTimeout(() => { applyingBounds = false; }, 0);
}

function defaultSkipperCorner(display: Electron.Display): { x: number; y: number } {
  const wa = display.workArea;
  return { x: wa.x + wa.width - 24, y: wa.y + wa.height - 24 };
}

// Corner-anchored bounds: the window's bottom-right pinned to the corner,
// clamped so the window stays on its display.
function cornerBounds(corner: { x: number; y: number }, w: number, h: number): Electron.Rectangle {
  const wa = screen.getDisplayNearestPoint(corner).workArea;
  const x = Math.max(wa.x + 8, Math.min(corner.x - w, wa.x + wa.width - w - 8));
  const y = Math.max(wa.y + 8, Math.min(corner.y - h, wa.y + wa.height - h - 8));
  return { x, y, width: w, height: h };
}

// Last call state pushed by the app window — replayed when the window
// (re)loads and on every pin, so the surface never renders from a blank (or
// stale) guess.
type PopoutState = {
  ttsState: 'idle' | 'synthesizing' | 'speaking';
  status: 'idle' | 'listening' | 'thinking' | 'speaking' | null;
  cameraOn: boolean;
  micMuted: boolean;
  screenSharing: boolean;
  speakerMuted: boolean;
  activityText: string | null;
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

function markSummonPending() {
  summonPendingAt = Date.now();
}

/**
 * Which surface the pinned role expands to. There is ONE hover surface —
 * the Skipper card (composer + footer dock) — regardless of how the
 * session was started (⌥⇧Space, the composer's call button, a minimized
 * call). Only a live CAMERA forces the pill, because the pill is where the
 * self-view lives; a screen share shows no pixels in the pill either, so
 * sharing never hijacks the card.
 */
export function getExpandedSurface(): 'card' | 'pill' {
  return lastPopoutState?.cameraOn ? 'pill' : 'card';
}

// --- Reveal protocol (see the file header) ---
let modeSeq = 0;
export function getModeSeq(): number {
  return modeSeq;
}
// The one action waiting for the renderer to paint a pushed role. A newer
// push supersedes it (the latest role wins); a timeout keeps a wedged or
// still-loading renderer from holding the window hostage.
let pendingPaint: { seq: number; fire: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
const PAINT_ACK_TIMEOUT_MS = 600;
const PAINT_ACK_LOADING_TIMEOUT_MS = 6000;

function pushMode(win: BrowserWindow): number {
  modeSeq += 1;
  win.webContents.send('quick-ask:mode', {
    seq: modeSeq,
    mode,
    collapsed: pinnedCollapsed,
    surface: getExpandedSurface(),
  });
  return modeSeq;
}

/**
 * Run `action` once the renderer has painted the role pushed as `seq` (or
 * any later one) — used to reveal the window, and to shrink it on fold so
 * the old layout is never squeezed into the new bounds for a frame.
 */
function afterModePainted(win: BrowserWindow, seq: number, action: () => void) {
  if (pendingPaint) clearTimeout(pendingPaint.timer);
  const entry = {
    seq,
    fire: () => {
      if (pendingPaint !== entry) return;
      clearTimeout(entry.timer);
      pendingPaint = null;
      if (!win.isDestroyed()) action();
    },
    timer: setTimeout(() => entry.fire(), win.webContents.isLoading() ? PAINT_ACK_LOADING_TIMEOUT_MS : PAINT_ACK_TIMEOUT_MS),
  };
  pendingPaint = entry;
}

/** The renderer painted the role pushed as `seq`. */
export function onModeApplied(seq: number) {
  if (pendingPaint && seq >= pendingPaint.seq) pendingPaint.fire();
}

// A hide supersedes whatever reveal/resize was waiting on a paint — a late
// ack must not focus (or resize) a window that's gone away meanwhile.
function cancelPendingPaint() {
  if (!pendingPaint) return;
  clearTimeout(pendingPaint.timer);
  pendingPaint = null;
}

/**
 * Show the window for the role just pushed: ordered in immediately but
 * fully transparent (so the renderer, which is paused while hidden, can
 * paint), then made opaque — and focused when asked — once the paint ack
 * lands. Revealing only after the ack is what keeps the previous role's
 * layout from ever flashing.
 */
function revealAfterMode(win: BrowserWindow, seq: number, opts: { focus: boolean }) {
  if (!win.isVisible()) {
    win.setOpacity(0);
    win.showInactive();
  }
  afterModePainted(win, seq, () => {
    win.setOpacity(1);
    if (opts.focus && win.isVisible()) win.focus();
  });
}

function createWindow(): BrowserWindow {
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const preloadPath = app.isPackaged
    ? path.join(hereDir, '../preload/dist/preload.js')
    : path.join(hereDir, '../../../preload/dist/preload.js');
  const win = new BrowserWindow({
    width: scaled(SKIPPER_FRAME_WIDTH),
    height: scaled(SKIPPER_FRAME_HEIGHT),
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
    // The frame is mostly transparent — a native shadow would
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
  // Click-through until the renderer says the cursor is over paint (see
  // `applyInteractive`) — the transparent stage must never eat a click
  // meant for whatever the user has underneath it.
  win.setIgnoreMouseEvents(true, { forward: true });
  companionInteractive = false;
  // Float over fullscreen Spaces too, keeping the Dock icon
  // (skipTransformProcessType — without it, visibleOnFullScreen turns the
  // app into a macOS "agent" app while the window exists). macOS concepts —
  // on Windows `alwaysOnTop` alone is the whole story.
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  // Blur does NOTHING: the Skipper is a companion the user carries around
  // and works next to, so losing focus must never fold its text away or
  // take it off screen. Tucking is an explicit gesture (the handle, Esc, or
  // clicking the stage near the card); leaving is End & close.
  // Wherever the user drags the Skipper, that becomes its anchor — the
  // corner survives collapse/expand round-trips.
  win.on('move', () => {
    if (applyingBounds || win.isDestroyed() || mode !== 'pinned') return;
    const b = win.getBounds();
    skipperCorner = { x: b.x + b.width, y: b.y + b.height };
    markDragging(win);
  });
  win.on('closed', () => {
    if (quickAskWin === win) quickAskWin = null;
    companionInteractive = false;
    stopCursorWatch();
  });
  // Zoom factor resets on navigation — apply it once the page is in, and
  // replay the state the renderer needs to pick up where things stand. (The
  // renderer also PULLS all of it on mount — these pushes can land before
  // React has subscribed.)
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

function positionPinned(win: BrowserWindow) {
  // Top-right of the primary display, like the old popout window.
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = scaled(PINNED_WIDTH);
  setBoundsGuarded(win, {
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

/**
 * The ONE hover relay: ask the app window (it owns the chat AND the call
 * engine) to start the voice session that this window then pins as the
 * Skipper. No app window → it is recreated hidden (main.ts) and the relay
 * re-fires on its `quickAsk:appReady`; a window still loading is handled
 * the same way; an unanswered relay is re-sent once by the watchdog. The
 * app window is also where a summon that CAN'T start (voice unconfigured)
 * explains itself — this window only ever shows the Skipper.
 */
export function relaySummon(opts: { retry?: boolean } = {}) {
  const appWin = findAppWindow();
  markSummonPending();
  summonRelayAt = Date.now();
  if (!opts.retry) summonRetried = false;
  const appUp = !!appWin && !appWin.webContents.isLoading();
  if (appUp) {
    appWin.webContents.send('quick-ask:tuck', null);
  } else {
    ensureAppWindow?.();
  }
  armSummonWatchdog(appUp ? SUMMON_WATCHDOG_MS : SUMMON_WATCHDOG_APP_BOOT_MS);
}

/**
 * The global chord and the tray item: ONE outcome. While the Skipper is up
 * the chord TOGGLES its text panel (folded → unfold and focus, about to
 * read or type; open → fold it away) — handled here in main, so it works
 * even if the window's own controls are wedged: the keyboard is the escape
 * hatch. Otherwise it summons the companion.
 */
export function toggleQuickAsk() {
  // Ghostwriter: remember which app the user was in at the summon — the
  // paste-at-cursor target — BEFORE any of our windows can take focus.
  void import('./text-insert.js').then((m) => m.textInsertService.captureTarget()).catch(() => {});
  const win = getQuickAskWindow();
  if (mode === 'pinned' && win) {
    const expanding = pinnedCollapsed;
    setPinnedCollapsed(!pinnedCollapsed);
    if (expanding) win.focus();
    return;
  }
  relaySummon();
}

/**
 * Enter/leave the pinned role — the call engine's floating surface
 * (callSurface === 'popout' in the app window). Replaces the old separate
 * #video-popout window wholesale.
 */
export function setCompanionPinned(pinned: boolean) {
  if (pinned) {
    clearSummonWatchdog();
    if (mode === 'pinned') {
      summonPendingAt = 0;
      // Already pinned: re-assert the CURRENT presentation instead of
      // bailing — callSurface flaps in the app (fullscreen ⇄ popout) can
      // otherwise leave the window sized for one state while the renderer
      // shows the other. Recreate the window if it was destroyed — a live
      // call must never be left with no surface at all.
      const win0 = getQuickAskWindow() ?? createWindow();
      // A folded CARD keeps the expanded frame (see setPinnedCollapsed) —
      // only the pill has tucked bounds of its own.
      if (pinnedCollapsed && getExpandedSurface() !== 'card') positionTucked(win0);
      else applyExpandedSurface(win0, getExpandedSurface());
      const seq0 = pushMode(win0);
      if (lastPopoutState) win0.webContents.send('video:popout-state', lastPopoutState);
      revealAfterMode(win0, seq0, { focus: false });
      startCursorWatch();
      return;
    }
    let win = getQuickAskWindow();
    if (!win) win = createWindow();
    const fromSummon = Date.now() - summonPendingAt < 5000;
    summonPendingAt = 0;
    setMode('pinned', fromSummon ? 'call surface (summoned)' : 'call surface');
    // ONE landing for every entry point: the Skipper lands as one unit —
    // the card with the text panel already open (text is the default;
    // tucking is the user's gesture, never the arrival state) — anchored
    // at its corner (last dragged spot, else bottom-right of the cursor's
    // display). A camera-on call lands as the pill instead (self-view).
    pinnedCollapsed = false;
    const surface = getExpandedSurface();
    if (surface === 'card' && !skipperCorner) {
      skipperCorner = defaultSkipperCorner(
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      );
    }
    if (surface === 'card') {
      applyExpandedSurface(win, 'card');
    } else {
      positionPinned(win);
      appliedExpandedSurface = 'pill';
    }
    const seq = pushMode(win);
    // The renderer resets its call-state mirror whenever it leaves the
    // pinned role — replay the live state so the Skipper never paints from
    // a blank guess before the app's next push.
    if (lastPopoutState) win.webContents.send('video:popout-state', lastPopoutState);
    // The user just summoned their companion → focus so speaking, typing,
    // and Esc all work immediately. Otherwise appearing must not steal
    // focus from the app the user switched to — that would be a focus grab
    // mid-work.
    revealAfterMode(win, seq, { focus: fromSummon });
    startCursorWatch();
  } else {
    if (mode !== 'pinned') return;
    setMode('hidden', 'unpinned');
    pinnedCollapsed = false;
    summonPendingAt = 0;
    // (The cached call state is kept: a fullscreen ⇄ popout flap mid-call
    // must return to the same surface — camera on → pill. The app pushes
    // an idle state when the call ENDS, so nothing stale survives it.)
    const win = getQuickAskWindow();
    if (win) {
      pushMode(win);
      cancelPendingPaint();
      stopCursorWatch();
      releaseMouse();
      if (win.isVisible()) win.hide();
    }
  }
}

/**
 * Text-panel fold/unfold of the Skipper (and the pill's tuck). Both states
 * anchor on the SAME corner — the mascot's spot — so folding the text never
 * moves the mascot: the panel collapses toward it and unfolds from it,
 * wherever the user last dragged it. The pill keeps its edge-preserving
 * resize (camera surface, different geometry).
 */
export function setPinnedCollapsed(collapsed: boolean) {
  const win = getQuickAskWindow();
  if (!win || mode !== 'pinned') return;
  // Deliberately NO same-state short-circuit: geometry is re-applied and
  // mode re-pushed even when `collapsed` matches, so a renderer that
  // drifted out of sync (or a window left at the wrong size) self-heals on
  // the next request instead of wedging — a "no change" request is cheap
  // and idempotent.
  pinnedCollapsed = collapsed;
  if (collapsed) {
    // Fold the CARD: the frame does not change at all. The card simply
    // stops painting beside the mascot and the space it leaves is
    // click-through, so there is nothing to shrink — and nothing to flash.
    // (Shrinking here is what made the fold flicker: the frame is
    // bottom-right anchored, so a 504px square becoming a 225px one moves
    // its origin by 279px. On a transparent window the OS frame change and
    // Chromium's repaint of the newly-sized viewport are not atomic, so for
    // a frame or two the tucked layout was composited against the other
    // geometry — the mascot appearing well above where it lands.)
    const seq = pushMode(win);
    // Decided on the surface just PUSHED (not the one whose geometry is
    // currently applied), so the bounds always match the layout the
    // renderer is about to paint — the two can disagree for a tick when a
    // device flips mid-fold.
    if (getExpandedSurface() === 'card') return;
    // The PILL still resizes: it folds to a DIFFERENT layout (the corner
    // mini call pill), which only lands right in pill-sized bounds. Push
    // the layout FIRST and shrink once it's painted — shrinking first
    // squeezes the still-open pill into those bounds for a frame (every
    // control looks dead).
    afterModePainted(win, seq, () => {
      if (mode !== 'pinned' || !pinnedCollapsed) return;
      const b = win.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      const w = scaled(TUCKED_WIDTH);
      const h = scaled(TUCKED_HEIGHT);
      const inTopHalf = b.y + b.height / 2 < wa.y + wa.height / 2;
      let x = b.x + b.width - w;
      let y = inTopHalf ? b.y : b.y + b.height - h;
      x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
      y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
      setBoundsGuarded(win, { x, y, width: w, height: h });
    });
    return;
  }
  // Unfold: grow the window first (the extra area is transparent stage —
  // the mascot doesn't move), then the card paints into it.
  applyExpandedSurface(win, getExpandedSurface());
  pushMode(win);
  if (appliedExpandedSurface === 'card') win.focus();
}

function applyExpandedSurface(win: BrowserWindow, surface: 'card' | 'pill') {
  appliedExpandedSurface = surface;
  if (surface === 'card') {
    // Skipper geometry: corner-anchored frame — the card sits at the
    // bottom with the mascot at its right edge, i.e. at the anchor.
    if (!skipperCorner) {
      skipperCorner = defaultSkipperCorner(screen.getDisplayMatching(win.getBounds()));
    }
    setBoundsGuarded(win, cornerBounds(skipperCorner, scaled(SKIPPER_FRAME_WIDTH), scaled(SKIPPER_FRAME_HEIGHT)));
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
  setBoundsGuarded(win, { x, y, width: w, height: h });
  win.setHasShadow(false);
}

function positionTucked(win: BrowserWindow) {
  // Fold to the mascot's anchor corner — wherever the Skipper was last
  // dragged, never a canonical spot that would teleport it.
  if (!skipperCorner) {
    skipperCorner = defaultSkipperCorner(screen.getDisplayMatching(win.getBounds()));
  }
  setBoundsGuarded(win, cornerBounds(skipperCorner, scaled(TUCKED_WIDTH), scaled(TUCKED_HEIGHT)));
  win.setHasShadow(false);
}

/** Renderer-driven pill height (response panel open/folded). Pinned only. */
export function resizeCompanionPinned(height: number) {
  const win = getQuickAskWindow();
  if (!win || mode !== 'pinned' || pinnedCollapsed) return;
  const clamped = scaled(Math.max(PINNED_BASE_HEIGHT, Math.min(PINNED_MAX_HEIGHT, Math.round(height))));
  const bounds = win.getBounds();
  setBoundsGuarded(win, { ...bounds, height: clamped });
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

/**
 * Relay a batch of recording-waveform amplitudes to the companion. NOT
 * cached (unlike the call state): a waveform is only meaningful live, and
 * replaying stale bars on window load would draw a voice nobody is using.
 */
export function pushPopoutLevels(levels: number[]) {
  getQuickAskWindow()?.webContents.send('video:popout-levels', { levels });
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

// --- Customizable global chord ---
// One accelerator is the source of truth (app_settings.json). `registered`
// tracks whether the OS actually granted it — false means another app owns
// the chord and quick-ask is unreachable until the user rebinds (we notify,
// we never silently rebind: a shortcut that moves on its own is worse than
// one that's honestly broken).
let currentShortcut = DEFAULT_QUICK_ASK_SHORTCUT;
let shortcutRegistered = false;
// Subscribers outside this module (the tray menu shows the chord next to
// "Quick Ask") — a callback instead of an import, because tray.ts already
// imports toggleQuickAsk from here.
const shortcutChangeListeners: (() => void)[] = [];
export function onQuickAskShortcutChanged(listener: () => void) {
  shortcutChangeListeners.push(listener);
}

export function getQuickAskShortcutState(): {
  accelerator: string;
  registered: boolean;
  isDefault: boolean;
} {
  return {
    accelerator: currentShortcut,
    registered: shortcutRegistered,
    isDefault: currentShortcut === DEFAULT_QUICK_ASK_SHORTCUT,
  };
}

function broadcastShortcutState() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('quick-ask:shortcut-changed', {
      accelerator: currentShortcut,
      registered: shortcutRegistered,
    });
  }
  for (const listener of shortcutChangeListeners) listener();
}

// The shortcut-recorder modal is capturing keys: the current chord is
// released so pressing it lands in the modal as keystrokes to display,
// instead of summoning the companion over the recorder.
let captureSuspended = false;

export function setShortcutCaptureActive(active: boolean) {
  if (captureSuspended === active) return;
  captureSuspended = active;
  if (!shortcutRegistered) return;
  if (active) {
    globalShortcut.unregister(currentShortcut);
    return;
  }
  // Resume. The grab can fail if another app snatched the chord during the
  // capture window — same treatment as a boot-time conflict (broadcast so
  // the settings row shows the "not active" notice).
  let ok = false;
  try {
    ok = globalShortcut.register(currentShortcut, () => toggleQuickAsk());
  } catch {
    ok = false;
  }
  if (!ok) {
    shortcutRegistered = false;
    broadcastShortcutState();
  }
}

/**
 * Rebind the global chord (null = reset to default). The NEW chord is
 * registered before the old one is released — a rejected rebind (invalid,
 * system-reserved, or owned by another app) leaves the current binding
 * fully intact. register() returning false is the OS-level conflict signal
 * (RegisterEventHotKey / RegisterHotKey failing because another app holds
 * the chord); macOS system chords that would "register" but never fire are
 * rejected up front via the shared blocklist.
 */
export function setQuickAskShortcut(accelerator: string | null): {
  ok: boolean;
  accelerator: string;
  registered: boolean;
  error: string | null;
} {
  const requested = accelerator === null
    ? DEFAULT_QUICK_ASK_SHORTCUT
    : normalizeShortcut(accelerator);
  const fail = (error: string) => ({
    ok: false,
    accelerator: currentShortcut,
    registered: shortcutRegistered,
    error,
  });
  if (!requested) {
    return fail('Use one or two modifier keys plus a regular key.');
  }
  if (isSystemReservedShortcut(requested, process.platform)) {
    return fail('That shortcut is reserved by the system.');
  }
  if (requested === currentShortcut && shortcutRegistered) {
    return { ok: true, accelerator: currentShortcut, registered: true, error: null };
  }
  const previous = currentShortcut;
  const previousRegistered = shortcutRegistered;
  let ok = false;
  try {
    ok = globalShortcut.register(requested, () => toggleQuickAsk());
  } catch {
    return fail('That key combination can’t be used as a shortcut.');
  }
  if (!ok) {
    return fail('That shortcut is already in use by another app.');
  }
  // While the recorder modal is capturing, nothing may stay grabbed — the
  // register() above was purely the conflict check. The resume in
  // setShortcutCaptureActive re-grabs whatever chord is current by then.
  if (captureSuspended) {
    globalShortcut.unregister(requested);
  }
  if (previousRegistered && previous !== requested && !captureSuspended) {
    globalShortcut.unregister(previous);
  }
  currentShortcut = requested;
  shortcutRegistered = true;
  saveAppSettings({
    quickAskShortcut: requested === DEFAULT_QUICK_ASK_SHORTCUT ? undefined : requested,
  });
  broadcastShortcutState();
  return { ok: true, accelerator: currentShortcut, registered: true, error: null };
}

export function initQuickAsk(opts: { ensureAppWindow?: () => void } = {}) {
  ensureAppWindow = opts.ensureAppWindow ?? null;
  // Default ⌥⇧Space: plain ⌥Space is the most contested launcher chord on
  // macOS (Raycast, ChatGPT desktop, …) — registering it would silently
  // lose or, worse, double-fire alongside whatever owns it.
  const saved = loadAppSettings().quickAskShortcut;
  currentShortcut =
    (saved ? normalizeShortcut(saved) : null) ?? DEFAULT_QUICK_ASK_SHORTCUT;
  try {
    shortcutRegistered = globalShortcut.register(currentShortcut, () => toggleQuickAsk());
  } catch {
    shortcutRegistered = false;
  }
  if (!shortcutRegistered) {
    // Another app owns the chord — quick-ask stays unavailable rather than
    // fighting over it. The app window surfaces this on boot (it invokes
    // quickAsk:getShortcut) with a "Change shortcut" action.
    console.warn(`[quick-ask] failed to register ${currentShortcut} (already taken?)`);
  }
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}
