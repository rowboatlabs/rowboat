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
    console.log(`[deeplink] dispatch ${url}`);
    if (!url.startsWith(URL_PREFIX)) {
        console.log(`[deeplink] rejected: bad prefix`);
        return;
    }

    pendingUrl = url;

    const win = mainWindowRef;
    if (!win || win.isDestroyed()) {
        console.log(`[deeplink] no window, buffered`);
        return;
    }

    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();

    if (win.webContents.isLoading()) {
        console.log(`[deeplink] window loading, buffered`);
        return;
    }

    console.log(`[deeplink] sending app:openUrl to renderer`);
    win.webContents.send("app:openUrl", { url });
    pendingUrl = null;
}
