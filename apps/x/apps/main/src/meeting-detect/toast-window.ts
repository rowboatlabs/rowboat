import { BrowserWindow, screen } from "electron";
import { dispatchUrl } from "../deeplink.js";

// Notion-style meeting toast: top-center frameless window with our own HTML.
// Persistent — closes only when the user clicks the CTA or the X.
//
// Spec: white card, top: 24px, max-width 640, slide-down entry animation.

const TOAST_WIDTH = 560;
const TOAST_HEIGHT = 92;
const TOAST_TOP_MARGIN = 24;

export interface ToastPayload {
    title: string;
    subtitle: string;
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
    body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; color: #0A0A0A; }
    .card {
      position: relative;
      box-sizing: border-box;
      max-width: 560px;
      width: 100%;
      background: #FFFFFF;
      border-radius: 14px;
      padding: 16px 44px 16px 20px; /* extra right padding to clear the X */
      display: flex;
      align-items: center;
      gap: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04);
      -webkit-app-region: drag;
      animation: slidein 300ms cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes slidein {
      from { transform: translateY(-20px); opacity: 0; }
      to   { transform: translateY(0);     opacity: 1; }
    }
    .wordmark {
      font-weight: 700;
      font-size: 16px;
      color: #0A2540;
      letter-spacing: -0.01em;
      -webkit-app-region: drag;
      user-select: none;
    }
    .divider {
      width: 1px;
      height: 28px;
      background: #E5E7EB;
      flex-shrink: 0;
    }
    .text {
      flex: 1;
      min-width: 0;
      -webkit-app-region: no-drag;
    }
    .title {
      font-weight: 600;
      font-size: 15px;
      color: #0A0A0A;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .subtitle {
      font-weight: 400;
      font-size: 13px;
      color: #6B7280;
      line-height: 1.3;
      margin-top: 3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    a.cta {
      -webkit-app-region: no-drag;
      display: inline-block;
      flex-shrink: 0;
      background: #0A2540;
      color: #FFFFFF;
      font-weight: 500;
      font-size: 13px;
      padding: 9px 18px;
      border-radius: 8px;
      text-decoration: none;
      cursor: pointer;
      user-select: none;
      transition: background 120ms ease;
    }
    a.cta:hover { background: #081C33; }
    a.cta:focus-visible { outline: 2px solid #0A2540; outline-offset: 2px; }
    a.close {
      -webkit-app-region: no-drag;
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      color: #4B5563;
      cursor: pointer;
      transition: background 120ms ease;
    }
    a.close:hover { background: #F3F4F6; }
    a.close:focus-visible { outline: 2px solid #0A2540; outline-offset: 2px; }
    a.close svg { display: block; }
  </style>
</head>
<body>
  <div class="card" role="alert" aria-live="polite">
    <div class="wordmark">rowboat</div>
    <div class="divider" aria-hidden="true"></div>
    <div class="text">
      <div class="title">${escapeHtml(payload.title)}</div>
      <div class="subtitle">${escapeHtml(payload.subtitle)}</div>
    </div>
    <a class="cta" href="${escapeAttr(payload.actionLink)}">${escapeHtml(payload.actionLabel)}</a>
    <a class="close" href="rowboat-toast://dismiss" aria-label="Dismiss meeting notification">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6 6 18"/>
        <path d="m6 6 12 12"/>
      </svg>
    </a>
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
        win.setAlwaysOnTop(true, "screen-saver");
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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
        });

        win.once("ready-to-show", () => win.show());
        win.on("closed", () => { if (this.win === win) this.win = null; });

        const html = buildToastHtml(payload);
        win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));

        this.win = win;
        // No auto-dismiss — persistent until X or CTA click (per spec).
    }

    closeImmediate(): void {
        if (this.win && !this.win.isDestroyed()) this.win.close();
        this.win = null;
    }
}
