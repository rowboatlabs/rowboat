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
import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  IScreenPointerService,
  ScreenPointerResult,
  ScreenPointerTarget,
} from '@x/core/dist/application/screen-pointer/service.js';

const DEFAULT_DURATION_MS = 8000;

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
