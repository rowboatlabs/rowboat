import { app, Menu, Tray, nativeImage } from "electron";

/**
 * Menu bar / system tray presence (Granola-style resident app).
 *
 * The icon is the app glyph pre-rendered as a macOS "template" image
 * (pure black + alpha, derived from icons/icon.png: alpha = pixel
 * luminance, so the white sail becomes an opaque black shape and the
 * black rounded square becomes transparent). Embedded as base64 so the
 * tray never depends on asset paths that differ between dev and
 * packaged layouts. Template rendering makes macOS tint it correctly
 * in light/dark menu bars and while highlighted.
 */
const TRAY_ICON_18 =
  "iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAABRElEQVR4nKySMS9EQRSF7773REEUlFpRiEg0Oj1RqTQqCiLRKNV+gkLvF5CoJRqJPyBEqyMURJB9zzl5Z3bvTuZtdjdu8mVm7sw9c+fOzWw0a4HMO3Ib3DJRaV0NK5QrqHLBM2AB/IAvOgrrn0EJ2pqvgg2N82AarIBX7jcJtSQyCXbALliKzryDJ83LIiEQnrAFTsBcOOxg3CN4C4FFQmQCnINN+b/BmPZDvTi/0T597SwS4dtvwTK4VPrj1mu5zl9oXQWBMDKTfXAPruSfBcfgwOqi03j5A1h0vo5QJ0W3Dr9GOwN7eiYzPASn/owXSgmEBmTfsLhT4NnqHvqMg2IrozkvewHXyvpIIj2xqYyajJncWf2bPuvGjFL76+ADbFu3WW0YIdaHvcYfWrOoLt4GeVquC3+t228jCfmzVb/b/sX+AAAA//+fzjrgAAAABklEQVQDAHsTRGNUkus5AAAAAElFTkSuQmCC";
const TRAY_ICON_36 =
  "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAC3klEQVR4nOyYu4sUQRDGa3fm8DgxUxB8ICqKqBj4QBOFMxMDRQUfgS/0D1A0MRQMTA1MxBcngpFmBiocgokgCopo4PnCSE193e74FV11XTtMz+zs9sLB3Qc/drenp/ubrqruuUtpmimlaaYZb6gBmvK9DbKiDoNUU+bIxEClEoqvRIxkOYbBcrAJ7ALzwATlFiVWyDQULYE1F2wE28E2sBYsJr8I58Fjc18UQw2hLYOOgJ1gHxgFSwru+SsmXsnvjjzq1ZA1wgOuBMfBQXJhUbUF7c8akraJWIZ4yVsyEIfhjBgZket6TRPa5mkmbd/AZ9PWk6GGmXAhuABOgTnSPikmmoH79F7+/Rr8IV+BtQ3xJFq2HJpLYkqNJNS5EkXbiVYb65kZt1XXkIZoAbhKLmGtkdRMFNrXMmOA+4zn2qdUtTGqma1gDKwAv2XgtOD+MkOaV5w/XAS/ijqmXZjZA+6QT9ph00erLDGTFpnitkn5fCRmbBpUGtLYHgU3pe0teAKegnVgL7kqI+lrjwlrKh+ue1Si0NPwICfBFXAX3CaXiP9MP16V3eSqbXOFKb32BawmF/ZCNQvaeDDOlWVgvRgbFzOJgSd5QO5YuEyd+5OaUnRzHBMzwTM0lIRD5FcjofBpnZDPIzZ1jnz12Qdk8ZGxBnykgv2nyhDLnthl0oOVjb0AG8itlOYnPxg/4C1wjALJrCp7/agykjfF/b+CI9QZNq2ww+BH1UBNiiPNkYfgHflQtuT7NfCe/KoHFfMFTZN6PthBblU4bLwq+ymwEeYVa4WsXspnW8Y/C75TSSJbDeIlf1Q+eUe/T24PK01kq9gv+fyAb8Aq8IncK+xPudZVkcQKmY6zhfzBeYBc/nQVKlXskJ0Wc4fAc6oRKlWMkOkKLCUXphPgBvmqqz1Yv9K95SL4AK73aiaWIRYfDYvInVO1w0QDMKTqywwr5k5dq5pCGsTf9n1p9h9WVfoPAAD//0eu+ckAAAAGSURBVAMAjdCu7L3gD4wAAAAASUVORK5CYII=";

interface TrayActions {
  openApp: () => void;
  toggleMeetingNotes: () => void;
}

let tray: Tray | null = null;
let actions: TrayActions | null = null;
let recording = false;

// Tray commands issued while the renderer wasn't ready to receive them
// (window closed or still loading). Drained by the renderer on mount via
// app:consumePendingTrayCommand — same pull pattern as pending deep links.
let pendingToggleMeetingNotes = false;

export function markPendingToggleMeetingNotes(): void {
  pendingToggleMeetingNotes = true;
}

export function consumePendingToggleMeetingNotes(): boolean {
  const value = pendingToggleMeetingNotes;
  pendingToggleMeetingNotes = false;
  return value;
}

function buildTrayIcon() {
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({
    scaleFactor: 1,
    buffer: Buffer.from(TRAY_ICON_18, "base64"),
  });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: Buffer.from(TRAY_ICON_36, "base64"),
  });
  icon.setTemplateImage(true);
  return icon;
}

export function createAppTray(trayActions: TrayActions): void {
  if (tray) return;
  actions = trayActions;

  try {
    tray = new Tray(buildTrayIcon());
  } catch (error) {
    // Tray support can be missing (some Linux environments). The app just
    // behaves as before: no resident presence.
    console.error("[Tray] Failed to create tray:", error);
    return;
  }

  rebuildMenu();

  // macOS opens the context menu on any click. On Windows/Linux a plain
  // left-click should open the app; the menu stays on right-click.
  if (process.platform !== "darwin") {
    tray.on("click", () => actions?.openApp());
  }
}

export function hasTray(): boolean {
  return tray !== null;
}

export function isRecordingActive(): boolean {
  return recording;
}

export function setTrayRecordingState(isRecording: boolean): void {
  if (recording === isRecording) return;
  recording = isRecording;
  rebuildMenu();
  if (isRecording) startWaveAnimation();
  else stopWaveAnimation();
}

// --- Recording indicator: animated mini-waveform beside the tray icon ---
// macOS renders tray titles to the right of the icon. Braille cells give
// 1-dot-wide bars (two bars per character, four height steps each) — a slim
// waveform, an unmissable "Rowboat is capturing this meeting" signal.

const WAVE_FRAME_MS = 300;
const WAVE_BAR_COUNT = 5;
// Dot bits for a bar of height 1–4 (index 0–3), built bottom-up. Two bars
// per braille cell (left column: dots 7,3,2,1 — right column: dots 8,6,5,4)
// keeps the columns tightly packed; the sine wave keeps every bar ≥1 dot so
// no column ever reads as missing.
const WAVE_LEFT_BITS = [0x40, 0x44, 0x46, 0x47];
const WAVE_RIGHT_BITS = [0x80, 0xa0, 0xb0, 0xb8];
// Radians per bar / per frame: together they make the crest travel smoothly
// leftward across the five bars.
const WAVE_SPATIAL_STEP = 1.1;
const WAVE_PHASE_STEP = 0.9;

let waveTimer: NodeJS.Timeout | null = null;
let wavePhase = 0;

function waveString(phase: number): string {
  const levels: number[] = [];
  for (let i = 0; i < WAVE_BAR_COUNT; i++) {
    const level = Math.round(1.5 + 1.5 * Math.sin(phase + i * WAVE_SPATIAL_STEP));
    levels.push(Math.min(3, Math.max(0, level)));
  }
  let out = "";
  for (let i = 0; i < levels.length; i += 2) {
    const left = WAVE_LEFT_BITS[levels[i]];
    const right = levels[i + 1] !== undefined ? WAVE_RIGHT_BITS[levels[i + 1]] : 0;
    out += String.fromCharCode(0x2800 + left + right);
  }
  return out;
}

function startWaveAnimation(): void {
  if (!tray || process.platform !== "darwin") return;
  stopWaveAnimation();
  waveTimer = setInterval(() => {
    if (!tray) return;
    wavePhase += WAVE_PHASE_STEP;
    tray.setTitle(` ${waveString(wavePhase)}`, { fontType: "monospaced" });
  }, WAVE_FRAME_MS);
}

function stopWaveAnimation(): void {
  if (waveTimer) {
    clearInterval(waveTimer);
    waveTimer = null;
  }
  if (tray && process.platform === "darwin") tray.setTitle("");
}

function rebuildMenu(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Open Rowboat", click: () => actions?.openApp() },
    recording
      ? {
          label: "Stop recording and generate notes",
          click: () => actions?.toggleMeetingNotes(),
        }
      : {
          label: "Start meeting notes",
          click: () => actions?.toggleMeetingNotes(),
        },
    { type: "separator" },
    { label: "Quit Rowboat", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(recording ? "Rowboat — recording meeting" : "Rowboat");
}
