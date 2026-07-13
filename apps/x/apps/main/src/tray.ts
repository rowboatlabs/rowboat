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
const TRAY_ICON_16 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAABD0lEQVR4nKSSz+pBQRTH585vfgtrllYiSkpJHkAegLJQlvIE9soD2MvSE3gCG57ARiwoe2Kl/Lm+J2d0XJd7y7c+dc898z1zzswYFV6OwAU3+zNIf9LglwwyWqKgBKogBpZAa+XfKukKIqABxmABJqAPcnat8Zi1aLUNOiAl8hfeYMaxazw7kzkNRqAoOpFjHcCc45sWZpqzxtVpxqPIac6TpmDP/5UtQMkkz1YGCZAHA89YDndnv1+u8R+c1buGoMVFtiADTjYpb+HMsSNy9N3llinusfnpC/OQSBuwAwWO7Xko88VkDzarHo+owvHLpkEFSHXQBCtR9G3RJ9HBxsHazxymgFzn+iWM+sFMugMAAP//whjxNQAAAAZJREFUAwCzrTaLm3OP9AAAAABJRU5ErkJggg==";
const TRAY_ICON_32 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACfUlEQVR4nMSXO2gUURSGz8yuYuGjsBHFBza+UGwULUxjoY0iWPnA0lZQURDsFC1E7Owt7JQ0SZGQLk2SNoQEQhICCXlUCXk/ZvOf3HM2Z2/uZDM7m90fPnbm3jn3P/e5M0VqsorUZBWocYqogQnEhj1VzwTUsOTBOgJOg1WwYYMiyqdITDe9RK6CW+A2uAYugOPgBhiXuO3kal2E1pg5BO6BJ+A+uEK7OzcJpuVaR6amBArG+Bx4BZ6LqZUOdSI+I+SmoEJZEoilMTa+CN6Cl+CEMUrkuUgS5d91+e33OpApAQ06Cj6CN+CY1G14pqryPMt1b6jhagloI2z+EPwCl4xxgXabqnQXFCW+R8oTaxDvw5z1DbSL+Zpp2D4bpcTz7zAYMomVVaxizkP+FzwydYfJ9Uh3QskYWXGZrolOiamY/7QE1Pwk6AaXwTzoA7OghdyhQtJY7PVWzcnU/fPKK8xC5mdBB1gGv6UHY/IMr/rH4D25gyUtCS3n4efDaJ1Seuvf8xC/BhPgv1dnTz1+7qskogvSrhsu4wPqM/hCgeEPJUC0s99VBbkveWXa2A/wzktC45fILdxJL7kKM1+JV7cZCNRFyIYfwICXqA7/HzGPA22Ue5KmElWXjtYceCrXuiVXwDOp27OBPNJpaAVT5HaVTsVPcv98qb0nqs/7ABvw4XQTXJf7UfBCEkyqBeeV9u6UXHObvIsW9xOcNwFd2WfAHWnvO+iinUV5oAlo/ANyx3Yb+EQpez6keryS8QgMkjvp7oIFStnzIeX5LtAtyK9h3OOWrOZ5E9C/5PPk3gdnspoT5Z8Ce2xnNtegeqgmc1YjP82CavrHadMT2AIAAP//JKuLxQAAAAZJREFUAwAJ75pCeqjxVQAAAABJRU5ErkJggg==";

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
    buffer: Buffer.from(TRAY_ICON_16, "base64"),
  });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: Buffer.from(TRAY_ICON_32, "base64"),
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

export function setTrayRecordingState(isRecording: boolean): void {
  if (recording === isRecording) return;
  recording = isRecording;
  rebuildMenu();
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
