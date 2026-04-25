import { BrowserWindow } from "electron";

export const DEEP_LINK_SCHEME = "rowboat";
const URL_PREFIX = `${DEEP_LINK_SCHEME}://`;

let pendingUrl: string | null = null;
let mainWindowRef: BrowserWindow | null = null;

export function setMainWindowForDeepLinks(win: BrowserWindow | null): void {
    mainWindowRef = win;
}

export function consumePendingDeepLink(): string | null {
    const url = pendingUrl;
    pendingUrl = null;
    return url;
}

export function extractDeepLinkFromArgv(argv: readonly string[]): string | null {
    for (const arg of argv) {
        if (typeof arg === "string" && arg.startsWith(URL_PREFIX)) return arg;
    }
    return null;
}

export function dispatchDeepLink(url: string): void {
    if (!url.startsWith(URL_PREFIX)) return;

    pendingUrl = url;

    const win = mainWindowRef;
    if (!win || win.isDestroyed()) return;

    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();

    if (win.webContents.isLoading()) return;

    win.webContents.send("app:openUrl", { url });
    pendingUrl = null;
}
