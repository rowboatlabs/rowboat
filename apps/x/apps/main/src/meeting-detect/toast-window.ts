import { BrowserWindow, screen } from "electron";
import { dispatchUrl } from "../deeplink.js";

// Custom Notion-style meeting toast: top-center frameless window with our
// own React-less HTML. We avoid the OS notification API because Windows
// and macOS both force-position native notifications (bottom-right / top-
// right respectively) and we want top-center.
//
// Lifecycle:
//   show()  → opens window, slides in, auto-closes at AUTO_DISMISS_MS
//   action button click → navigation to rowboat:// → dispatchUrl + close
//   dismiss button click → navigation to rowboat://dismiss → just close

const TOAST_WIDTH = 460;
const TOAST_HEIGHT = 110;
const TOAST_TOP_MARGIN = 56;
const AUTO_DISMISS_MS = 30_000;

export interface ToastPayload {
    title: string;
    message: string;
    actionLabel: string;
    actionLink: string;
}

/** Build the self-contained HTML the toast window renders. Pure — tested. */
export function buildToastHtml(payload: ToastPayload): string {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: transparent; overflow: hidden; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; }
    .card {
      box-sizing: border-box;
      width: 100%; height: 100%;
      background: rgba(28, 28, 32, 0.96);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 14px 18px;
      display: flex; align-items: center; gap: 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.45);
      backdrop-filter: blur(18px);
      -webkit-app-region: drag;
      animation: slidein 240ms ease-out;
    }
    @keyframes slidein {
      from { transform: translateY(-12px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    .body { flex: 1; min-width: 0; -webkit-app-region: no-drag; }
    .title { font-size: 13px; font-weight: 600; line-height: 1.2; }
    .msg   { font-size: 12px; opacity: 0.72; margin-top: 4px;
             overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; gap: 8px; -webkit-app-region: no-drag; }
    a.btn {
      display: inline-block; padding: 7px 14px; border-radius: 8px;
      font-size: 12px; font-weight: 600; text-decoration: none;
      cursor: pointer; user-select: none;
    }
    a.primary   { background: #4f8cff; color: #fff; }
    a.primary:hover { background: #6499ff; }
    a.secondary { background: rgba(255,255,255,0.08); color: #e8e8e8; }
    a.secondary:hover { background: rgba(255,255,255,0.12); }
  </style>
</head>
<body>
  <div class="card">
    <div class="body">
      <div class="title">${escapeHtml(payload.title)}</div>
      <div class="msg">${escapeHtml(payload.message)}</div>
    </div>
    <div class="actions">
      <a class="btn secondary" href="rowboat-toast://dismiss">Dismiss</a>
      <a class="btn primary"   href="${escapeAttr(payload.actionLink)}">${escapeHtml(payload.actionLabel)}</a>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

export class MeetingToastWindow {
    private win: BrowserWindow | null = null;
    private timer: NodeJS.Timeout | null = null;

    show(payload: ToastPayload): void {
        // If a previous toast is still up, replace it.
        this.closeImmediate();

        const display = screen.getPrimaryDisplay();
        const wa = display.workArea;
        const x = Math.round(wa.x + (wa.width - TOAST_WIDTH) / 2);
        const y = wa.y + TOAST_TOP_MARGIN;

        const win = new BrowserWindow({
            width: TOAST_WIDTH,
            height: TOAST_HEIGHT,
            x, y,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            focusable: false,
            show: false,
            hasShadow: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
            },
        });
        // alwaysOnTop with screen-saver level so it floats above full-screen apps too.
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

        // Intercept the action links — both rowboat:// (real deeplinks) and
        // rowboat-toast://dismiss (our internal dismiss signal).
        win.webContents.on("will-navigate", (event, url) => {
            event.preventDefault();
            if (url.startsWith("rowboat-toast://")) {
                this.closeImmediate();
                return;
            }
            if (url.startsWith("rowboat://")) {
                dispatchUrl(url);
                this.closeImmediate();
                return;
            }
            // Anything else (shouldn't happen with our own HTML) — ignore.
        });

        win.once("ready-to-show", () => win.show());
        win.on("closed", () => {
            if (this.win === win) this.win = null;
            if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        });

        const html = buildToastHtml(payload);
        // data: URL so we don't have to ship a separate file. Encoded so the
        // protocol parser doesn't choke on quotes / hashes in the payload.
        win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

        this.win = win;
        this.timer = setTimeout(() => this.closeImmediate(), AUTO_DISMISS_MS);
    }

    closeImmediate(): void {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        if (this.win && !this.win.isDestroyed()) this.win.close();
        this.win = null;
    }
}
