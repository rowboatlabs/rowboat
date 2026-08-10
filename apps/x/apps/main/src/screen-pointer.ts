/**
 * Screen pointer: while the user shares their screen on a call, the
 * assistant can point at a spot on the REAL display — a transparent,
 * click-through overlay window covering the shared (primary) display renders
 * an animated marker with an optional label (renderer hash #screen-pointer).
 *
 * This is the main-process implementation of core's IScreenPointerService
 * (registered in main.ts, same DI seam as browser control): the
 * screen-pointer builtin tool executes right here, no renderer round-trip.
 * The renderer only reports share start/stop (screenPointer:setShareActive),
 * which gates pointing and tears the overlay down when the share ends.
 */
import { DEV_SERVER_URL } from './dev-server.js';
import { app, BrowserWindow, screen, systemPreferences } from 'electron';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type {
  IScreenPointerService,
  ScreenClickTarget,
  ScreenPointerResult,
  ScreenPointerTarget,
  ScreenTypeInput,
} from '@x/core/dist/application/screen-pointer/service.js';

const execFileAsync = promisify(execFile);

const DEFAULT_DURATION_MS = 8000;
// The pointer shows WHERE before the click lands — the user must see it
// coming, never discover it happened.
const CLICK_TELEGRAPH_MS = 600;

const ACCESSIBILITY_ERROR =
  'macOS Accessibility permission is missing — clicking/typing needs it (separate from Screen Recording). '
  + 'Tell the user: System Settings → Privacy & Security → Accessibility → enable Rowboat, then try again. '
  + 'A system dialog offering this has just been shown; Settings → Permissions in Rowboat also has the grant.';

// Legacy: kept for the Settings panel's probe IPC (the schema still carries
// an automation key), but injection no longer uses System Events, so the
// permission itself is no longer required — getStatus reports it
// 'not-required' and the panel hides the row.
export type AutomationPermissionState = 'granted' | 'denied' | 'unknown';
let automationState: AutomationPermissionState = 'unknown';
export function getAutomationPermissionState(): AutomationPermissionState {
  return automationState;
}
export function setAutomationPermissionState(state: AutomationPermissionState): void {
  automationState = state;
}

// System Events refused even though OUR accessibility self-check passed
// (mapInjectionError only runs after ensureAccessibility) — with ad-hoc
// signed builds TCC can hold a grant that the running app matches while the
// System Events attribution doesn't. The fix is re-registering the grant.
const STALE_ACCESSIBILITY_ERROR =
  'macOS lists Rowboat as granted for Accessibility, yet System Events still refused to deliver the click/keystroke — '
  + 'the stored grant does not cover this exact build (common with unsigned/ad-hoc builds after reinstalling). '
  + 'Tell the user: System Settings → Privacy & Security → Accessibility → remove Rowboat with the "−" button, '
  + 're-add /Applications/Rowboat.app, make sure it is toggled ON, then try again.';

// Map an osascript failure to the grant the user must flip. CGEvent posting
// rarely errors (missing accessibility drops events silently — hence the
// upfront self-check), but any "not allowed" style failure still means the
// stored grant doesn't cover this build. The raw macOS message rides along —
// losing it made failures undiagnosable.
function mapInjectionError(raw: string, fallback: string): string {
  const detail = ` (macOS said: ${raw.slice(0, 300)})`;
  if (raw.includes('1002') || /not allowed|not permitted/i.test(raw)) {
    return STALE_ACCESSIBILITY_ERROR + detail;
  }
  return fallback;
}

// promisify(execFile) rejects with { stderr } attached — osascript puts the
// actual AppleScript error there, while err.message leads with the whole
// command line. Prefer the useful half.
function osascriptError(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr?.trim();
  if (stderr) return stderr;
  return err instanceof Error ? err.message : String(err);
}

type PointerState = {
  visible: boolean;
  x: number;
  y: number;
  label: string | null;
  nonce: number;
};

export class ElectronScreenPointerService implements IScreenPointerService {
  private overlayWin: BrowserWindow | null = null;
  private shareActive = false;
  private hideTimer: NodeJS.Timeout | null = null;
  // Replayed on overlay load — window creation races the first point.
  private lastState: PointerState | null = null;
  private nonce = 0;

  isShareActive(): boolean {
    return this.shareActive;
  }

  /** Renderer-reported share state; ending a share tears the overlay down. */
  setShareActive(active: boolean): void {
    if (this.shareActive !== active) {
      console.log(`[screen-pointer] share ${active ? 'started' : 'ended'}`);
    }
    this.shareActive = active;
    if (!active) void this.hide();
  }

  /** Overlay pulls this on mount — the did-finish-load push can beat the
   *  React listener registration (same race as video:getPopoutState). */
  getState(): PointerState | null {
    return this.lastState;
  }

  async point(target: ScreenPointerTarget): Promise<ScreenPointerResult> {
    if (!this.shareActive) {
      console.log('[screen-pointer] point rejected: no live share');
      return { success: false, error: 'No screen share is live.' };
    }
    console.log(`[screen-pointer] point x=${target.x.toFixed(3)} y=${target.y.toFixed(3)}${target.label ? ` label="${target.label}"` : ''}`);
    const state: PointerState = {
      visible: true,
      x: Math.min(1, Math.max(0, target.x)),
      y: Math.min(1, Math.max(0, target.y)),
      label: target.label?.trim() ? target.label.trim() : null,
      nonce: ++this.nonce,
    };
    this.pushState(state);
    this.ensureOverlay();

    if (this.hideTimer) clearTimeout(this.hideTimer);
    const duration = target.durationMs ?? DEFAULT_DURATION_MS;
    this.hideTimer = setTimeout(() => void this.hide(), duration);
    return { success: true };
  }

  async hide(): Promise<void> {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.lastState = null;
    // Destroy rather than blank: the overlay only exists while something is
    // being pointed at, so a stray transparent window can never linger over
    // the user's screen.
    if (this.overlayWin && !this.overlayWin.isDestroyed()) this.overlayWin.destroy();
    this.overlayWin = null;
  }

  // ---- v2: real input injection (macOS, CGEvents via osascript JXA) ----
  // No native module: osascript -l JavaScript + the ObjC bridge posts REAL
  // CGEvents (the canonical macOS input API). NOT System Events "click at" —
  // that command returns success without clicking on modern macOS (the
  // original v2 bug), and dropping System Events also drops the Automation
  // permission: Accessibility (isTrustedAccessibilityClient) is the only
  // gate. Both actions require a LIVE share — the user must be able to see
  // what is being done to their screen.
  //
  // Caveat: CGEventPost from an untrusted process drops events SILENTLY, so
  // the upfront self-check below is the only permission error we can raise.

  private ensureAccessibility(): boolean {
    if (process.platform !== 'darwin') return true;
    if (systemPreferences.isTrustedAccessibilityClient(false)) return true;
    // Fires the system "add Rowboat to Accessibility" dialog (no-op if
    // already listed but unchecked — Settings is the fix then).
    systemPreferences.isTrustedAccessibilityClient(true);
    return false;
  }

  async click(target: ScreenClickTarget): Promise<ScreenPointerResult> {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Clicking is only supported on macOS.' };
    }
    if (!this.shareActive) {
      console.log('[screen-pointer] click rejected: no live share');
      return { success: false, error: 'No screen share is live.' };
    }
    if (!this.ensureAccessibility()) {
      console.log('[screen-pointer] click rejected: accessibility not granted');
      return { success: false, error: ACCESSIBILITY_ERROR };
    }
    const x = Math.min(1, Math.max(0, target.x));
    const y = Math.min(1, Math.max(0, target.y));
    const { bounds } = screen.getPrimaryDisplay();
    const px = Math.round(bounds.x + x * bounds.width);
    const py = Math.round(bounds.y + y * bounds.height);
    console.log(`[screen-pointer] click x=${x.toFixed(3)} y=${y.toFixed(3)} → (${px},${py})${target.doubleClick ? ' double' : ''}`);

    // Telegraph: pointer on the spot, beat, then the click lands there.
    await this.point({ x, y, durationMs: CLICK_TELEGRAPH_MS + 2500 });
    await new Promise((r) => setTimeout(r, CLICK_TELEGRAPH_MS));

    // CGEvent numeric constants (the JXA bridge doesn't export enum names):
    // event types — 5 mouseMoved, 1 leftMouseDown, 2 leftMouseUp;
    // field 1 = clickState (2 on the second pair makes a real double-click);
    // CGEventPost tap 0 = kCGHIDEventTap.
    const script = `
      function run(argv) {
        ObjC.import('CoreGraphics');
        const x = parseFloat(argv[0]), y = parseFloat(argv[1]);
        const dbl = argv[2] === '1';
        const pt = { x: x, y: y };
        const post = function (e) { $.CGEventPost(0, e); };
        post($.CGEventCreateMouseEvent($(), 5, pt, 0));
        const pair = function (clickState) {
          const d = $.CGEventCreateMouseEvent($(), 1, pt, 0);
          $.CGEventSetIntegerValueField(d, 1, clickState);
          post(d);
          const u = $.CGEventCreateMouseEvent($(), 2, pt, 0);
          $.CGEventSetIntegerValueField(u, 1, clickState);
          post(u);
        };
        pair(1);
        if (dbl) { delay(0.08); pair(2); }
        return 'ok';
      }`;
    try {
      await execFileAsync(
        'osascript',
        ['-l', 'JavaScript', '-e', script, String(px), String(py), target.doubleClick ? '1' : '0'],
        { timeout: 5000 },
      );
      return { success: true };
    } catch (err) {
      const msg = osascriptError(err);
      console.error('[screen-pointer] click failed:', msg);
      return { success: false, error: mapInjectionError(msg, `Click failed: ${msg}`) };
    }
  }

  async typeText(input: ScreenTypeInput): Promise<ScreenPointerResult> {
    if (process.platform !== 'darwin') {
      return { success: false, error: 'Typing is only supported on macOS.' };
    }
    if (!this.shareActive) {
      console.log('[screen-pointer] type rejected: no live share');
      return { success: false, error: 'No screen share is live.' };
    }
    if (!this.ensureAccessibility()) {
      console.log('[screen-pointer] type rejected: accessibility not granted');
      return { success: false, error: ACCESSIBILITY_ERROR };
    }
    const text = input.text ?? '';
    if (!text.trim()) return { success: false, error: 'Nothing to type.' };
    console.log(`[screen-pointer] type ${text.length} chars${input.pressEnter ? ' + enter' : ''}`);

    // Text rides an environment variable (never spliced into the script and
    // never parsed as an argv option); newlines become real Return presses
    // (keycode 36). CGEventKeyboardSetUnicodeString types arbitrary unicode
    // with no keycode mapping; chunks stay small because apps only read a
    // limited number of unichars per event.
    const script = `
      function run() {
        ObjC.import('CoreGraphics');
        const env = $.NSProcessInfo.processInfo.environment;
        const text = env.objectForKey('ROWBOAT_TYPE_TEXT').js;
        const pressEnter = env.objectForKey('ROWBOAT_TYPE_ENTER').js === '1';
        const post = function (e) { $.CGEventPost(0, e); };
        const typeChunk = function (s) {
          const d = $.CGEventCreateKeyboardEvent($(), 0, true);
          $.CGEventKeyboardSetUnicodeString(d, s.length, s);
          post(d);
          const u = $.CGEventCreateKeyboardEvent($(), 0, false);
          $.CGEventKeyboardSetUnicodeString(u, s.length, s);
          post(u);
        };
        const pressReturn = function () {
          post($.CGEventCreateKeyboardEvent($(), 36, true));
          post($.CGEventCreateKeyboardEvent($(), 36, false));
        };
        const lines = text.split('\\n');
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) { pressReturn(); delay(0.02); }
          for (let j = 0; j < lines[i].length; j += 20) {
            typeChunk(lines[i].slice(j, j + 20));
            delay(0.01);
          }
        }
        if (pressEnter) { delay(0.05); pressReturn(); }
        return 'ok';
      }`;
    try {
      await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], {
        timeout: 20000,
        env: { ...process.env, ROWBOAT_TYPE_TEXT: text, ROWBOAT_TYPE_ENTER: input.pressEnter ? '1' : '0' },
      });
      return { success: true };
    } catch (err) {
      const msg = osascriptError(err);
      console.error('[screen-pointer] type failed:', msg);
      return { success: false, error: mapInjectionError(msg, `Typing failed: ${msg}`) };
    }
  }

  private pushState(state: PointerState): void {
    this.lastState = state;
    if (this.overlayWin && !this.overlayWin.isDestroyed()) {
      this.overlayWin.webContents.send('screen-pointer:state', state);
    }
  }

  private ensureOverlay(): void {
    if (this.overlayWin && !this.overlayWin.isDestroyed()) return;

    // Screen share always captures the primary display (no picker yet), so
    // the overlay covers its FULL bounds — frame coordinates are fractions
    // of the captured display, and the capture includes the menu bar.
    const { bounds } = screen.getPrimaryDisplay();
    const hereDir = path.dirname(fileURLToPath(import.meta.url));
    const preloadPath = app.isPackaged
      ? path.join(hereDir, '../preload/dist/preload.js')
      : path.join(hereDir, '../../../preload/dist/preload.js');
    const win = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      // Same fullscreen-Space guards as the call popout (ipc.ts).
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      // NSPanel: the pointer must appear over other apps' fullscreen Spaces —
      // the user is usually presenting something outside Rowboat.
      ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      transparent: true,
      // A transparent full-screen window must never take focus or rounded
      // corners — it's pure ink over the user's screen.
      focusable: false,
      roundedCorners: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: preloadPath,
      },
    });
    // Above the call pill ('floating') — the pointer is momentary ink and
    // must not end up under other overlay chrome.
    win.setAlwaysOnTop(true, 'screen-saver');
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
    // Click-through: the user keeps working underneath the pointer.
    win.setIgnoreMouseEvents(true);
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return;
      console.log('[screen-pointer] overlay loaded');
      // Best-effort replay; the overlay also PULLS via screenPointer:getState
      // on mount, since this push can fire before React has subscribed.
      if (this.lastState) win.webContents.send('screen-pointer:state', this.lastState);
      // showInactive: appearing must never steal focus from the app the
      // user is presenting.
      win.showInactive();
    });
    win.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error(`[screen-pointer] overlay failed to load: ${code} ${desc}`);
    });
    win.on('closed', () => {
      if (this.overlayWin === win) this.overlayWin = null;
    });
    this.overlayWin = win;
    if (app.isPackaged) {
      void win.loadURL('app://-/index.html#screen-pointer');
    } else {
      void win.loadURL(`${DEV_SERVER_URL}/#screen-pointer`);
    }
  }
}

export const screenPointerService = new ElectronScreenPointerService();
