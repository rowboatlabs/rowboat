import type { BrowserWindow } from "electron";

// Renderer zoom, shared by the Cmd/Ctrl + (+ / − / 0) keystrokes and the
// View-menu items (menu.ts).
//
// Keystrokes are handled via before-input-event rather than as menu
// accelerators: "+"/"=" share a physical key (as do "-"/"_"), and numpad
// +/- produce the same characters, so this covers combinations a single
// accelerator string can't. `event.preventDefault()` stops the keystroke
// from leaking into the editor — and, per Electron's contract, suppresses
// any matching menu accelerator, so the View items never double-fire.
const ZOOM_STEP = 0.5; // zoom-level units (factor = 1.2 ^ level, ~9.5% per step)
const MIN_ZOOM_LEVEL = -3;
const MAX_ZOOM_LEVEL = 3;

export function zoomIn(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setZoomLevel(Math.min(wc.getZoomLevel() + ZOOM_STEP, MAX_ZOOM_LEVEL));
}

export function zoomOut(win: BrowserWindow): void {
  const wc = win.webContents;
  wc.setZoomLevel(Math.max(wc.getZoomLevel() - ZOOM_STEP, MIN_ZOOM_LEVEL));
}

export function zoomReset(win: BrowserWindow): void {
  win.webContents.setZoomLevel(0);
}

export function setupZoomShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    // Cmd on macOS, Ctrl elsewhere.
    if (!(process.platform === "darwin" ? input.meta : input.control)) return;

    const key = input.key;
    if (key === "+" || key === "=") {
      zoomIn(win);
      event.preventDefault();
    } else if (key === "-" || key === "_") {
      zoomOut(win);
      event.preventDefault();
    } else if (key === "0") {
      zoomReset(win);
      event.preventDefault();
    }
  });
}
