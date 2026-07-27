/**
 * Global push-to-talk key hook (uiohook-napi).
 *
 * Watches the Right ⌘ key system-wide while a call (or the quick-ask bar)
 * needs it and relays down/up/chord transitions to the app window, which
 * owns the PTT state machine. The hook only runs while a consumer is
 * registered — no input monitoring outside calls.
 *
 * macOS gates global event taps behind the Input Monitoring permission
 * (TCC). Starting the hook triggers the system consent prompt on first use,
 * but a denied/pending grant doesn't error — events simply never arrive.
 * `eventsSeen` is the liveness signal the renderer polls to distinguish
 * "granted" from "silently dead" and show a proper permission dialog (its
 * in-window DOM listener keeps PTT working while the app is focused either
 * way).
 */
import { BrowserWindow, shell } from 'electron';

type PttKeyEvent = { type: 'down' | 'up' | 'chord' };

// libuiohook VC_META_R — the Right ⌘ key.
const META_RIGHT = 3676;

type UiohookModule = typeof import('uiohook-napi');

let hookModule: UiohookModule | null = null;
let loadFailed = false;
let listenersAttached = false;
let running = false;
// True once ANY input event arrives — mouse moves land within moments of
// hook start on a granted system, so a stale false means no permission.
let eventsSeen = false;
let metaRightHeld = false;

const reasons = new Set<string>();

let findTargetWindows: () => BrowserWindow[] = () => [];

/** Wire where PTT key events get delivered (the app window). */
export function initPtt(findTargets: () => BrowserWindow[]) {
  findTargetWindows = findTargets;
}

function broadcast(event: PttKeyEvent) {
  // Forwarding is gated on consumers, not on hook lifetime — see
  // setPttActive for why the hook keeps running between calls.
  if (reasons.size === 0) return;
  for (const win of findTargetWindows()) {
    if (!win.isDestroyed()) win.webContents.send('voice:ptt-key', event);
  }
}

async function loadModule(): Promise<UiohookModule | null> {
  if (hookModule || loadFailed) return hookModule;
  try {
    // Native module — load lazily so a missing/broken binary degrades to
    // "global PTT unavailable" instead of crashing the main process.
    hookModule = await import('uiohook-napi');
  } catch (err) {
    console.error('[ptt] failed to load uiohook-napi:', err);
    loadFailed = true;
  }
  return hookModule;
}

function attachListeners(mod: UiohookModule) {
  if (listenersAttached) return;
  listenersAttached = true;
  mod.uIOhook.on('keydown', (e) => {
    eventsSeen = true;
    if (e.keycode === META_RIGHT) {
      // OS key-repeat refires keydown while held — only the edge matters.
      if (!metaRightHeld) {
        metaRightHeld = true;
        broadcast({ type: 'down' });
      }
    } else if (metaRightHeld) {
      // Right ⌘ is acting as a modifier (⌘C etc.), not as the PTT key —
      // the renderer cancels the capture.
      broadcast({ type: 'chord' });
    }
  });
  mod.uIOhook.on('keyup', (e) => {
    eventsSeen = true;
    if (e.keycode === META_RIGHT && metaRightHeld) {
      metaRightHeld = false;
      broadcast({ type: 'up' });
    }
  });
  mod.uIOhook.on('mousedown', () => {
    eventsSeen = true;
    // ⌘-click with the held key: a chord, same as a keyboard one.
    if (metaRightHeld) broadcast({ type: 'chord' });
  });
  mod.uIOhook.on('mousemove', () => {
    eventsSeen = true;
  });
}

async function startHook() {
  const mod = await loadModule();
  if (!mod || running) return;
  attachListeners(mod);
  try {
    mod.uIOhook.start();
    running = true;
  } catch (err) {
    console.error('[ptt] failed to start hook:', err);
    loadFailed = true;
  }
}

function stopHook() {
  if (!hookModule || !running) return;
  try {
    hookModule.uIOhook.stop();
  } catch (err) {
    console.error('[ptt] failed to stop hook:', err);
  }
  running = false;
  metaRightHeld = false;
  eventsSeen = false;
}

/**
 * Reference-counted activation: key events are forwarded while at least one
 * consumer ('call', 'quick-ask') is active. The hook itself starts lazily on
 * the first consumer and then STAYS running for the app's lifetime —
 * libuiohook's stop/start cycle is unreliable on macOS (the recreated tap
 * intermittently delivers nothing, which surfaced as PTT "randomly" dying
 * on later calls). While no consumer is registered nothing is forwarded or
 * retained.
 */
export async function setPttActive(reason: string, active: boolean) {
  if (active) reasons.add(reason);
  else reasons.delete(reason);
  if (reasons.size > 0 && !running) await startHook();
  else if (reasons.size === 0) metaRightHeld = false;
}

export function getPttStatus() {
  return {
    supported: !loadFailed,
    running,
    eventsSeen,
  };
}

/**
 * Recreate the event tap after the user grants Input Monitoring — a tap
 * created pre-grant stays dead forever; a fresh one picks the grant up.
 */
export async function retryPttHook() {
  stopHook();
  if (reasons.size > 0) await startHook();
  return { running };
}

export async function openInputMonitoringSettings() {
  if (process.platform !== 'darwin') return { success: false };
  try {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    );
    return { success: true };
  } catch {
    return { success: false };
  }
}
