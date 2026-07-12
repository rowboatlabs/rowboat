import { BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { WorkDir } from "@x/core/dist/config/config.js";

// Persisted so a restart (especially restart-to-update) puts the window back
// exactly where the user had it instead of resetting to a maximized default.
const STATE_PATH = path.join(WorkDir, "config", "window-state.json");

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

export function loadWindowState(): WindowState | null {
  let raw: Partial<WindowState>;
  try {
    raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8")) as Partial<WindowState>;
  } catch {
    return null; // first run or unreadable — caller falls back to defaults
  }
  if (typeof raw.width !== "number" || typeof raw.height !== "number") return null;

  const state: WindowState = {
    width: Math.max(600, Math.round(raw.width)),
    height: Math.max(480, Math.round(raw.height)),
    x: typeof raw.x === "number" ? Math.round(raw.x) : undefined,
    y: typeof raw.y === "number" ? Math.round(raw.y) : undefined,
    maximized: raw.maximized === true,
  };

  // Only restore a position that still lands on a connected display — a
  // position saved on a since-unplugged monitor would open off-screen.
  if (state.x !== undefined && state.y !== undefined) {
    const MARGIN = 40; // require at least this much of the window on-screen
    const visible = screen.getAllDisplays().some(({ workArea: a }) => {
      return (
        state.x! < a.x + a.width - MARGIN &&
        state.x! + state.width > a.x + MARGIN &&
        state.y! >= a.y - MARGIN &&
        state.y! < a.y + a.height - MARGIN
      );
    });
    if (!visible) {
      state.x = undefined;
      state.y = undefined;
    }
  }
  return state;
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const save = () => {
    if (win.isDestroyed()) return;
    const state: WindowState = {
      // getNormalBounds() reports the pre-maximize bounds, so un-maximizing
      // after a restart returns to the size the user actually chose.
      ...win.getNormalBounds(),
      maximized: win.isMaximized(),
    };
    try {
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("[WindowState] save failed:", err);
    }
  };

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };

  win.on("resize", debounced);
  win.on("move", debounced);
  win.on("maximize", debounced);
  win.on("unmaximize", debounced);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}
