import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/dist/config/config.js";

export const DEEP_LINK_SCHEME = "rowboat";
const URL_PREFIX = `${DEEP_LINK_SCHEME}://`;
const ACTION_HOST = "action";

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

/**
 * Dispatch any rowboat:// URL — chooses navigation vs action automatically.
 * Use this from notification click handlers and other URL entry points.
 */
export function dispatchUrl(url: string): void {
    if (parseAction(url)) {
        void dispatchAction(url);
    } else {
        dispatchDeepLink(url);
    }
}

export function dispatchDeepLink(url: string): void {
    if (!url.startsWith(URL_PREFIX)) return;

    pendingUrl = url;

    const win = mainWindowRef;
    if (!win || win.isDestroyed()) return;
    focusWindow(win);

    if (win.webContents.isLoading()) return;

    win.webContents.send("app:openUrl", { url });
    pendingUrl = null;
}

interface MeetingNotesAction {
    type: "take-meeting-notes" | "join-and-take-meeting-notes";
    eventId: string;
}

type ParsedAction = MeetingNotesAction;

function parseAction(url: string): ParsedAction | null {
    if (!url.startsWith(URL_PREFIX)) return null;
    const rest = url.slice(URL_PREFIX.length);
    const queryIdx = rest.indexOf("?");
    const host = (queryIdx >= 0 ? rest.slice(0, queryIdx) : rest).replace(/\/$/, "");
    if (host !== ACTION_HOST) return null;
    const params = new URLSearchParams(queryIdx >= 0 ? rest.slice(queryIdx + 1) : "");
    const type = params.get("type");
    if (type === "take-meeting-notes" || type === "join-and-take-meeting-notes") {
        const eventId = params.get("eventId");
        return eventId ? { type, eventId } : null;
    }
    return null;
}

async function dispatchAction(url: string): Promise<void> {
    const parsed = parseAction(url);
    if (!parsed) return;

    const openMeeting = parsed.type === "join-and-take-meeting-notes";
    await handleTakeMeetingNotes(parsed.eventId, openMeeting);
}

async function handleTakeMeetingNotes(eventId: string, openMeeting: boolean): Promise<void> {
    const win = mainWindowRef;
    if (!win || win.isDestroyed()) return;
    focusWindow(win);

    const filePath = path.join(WorkDir, "calendar_sync", `${eventId}.json`);
    let event: unknown;
    try {
        const raw = await fs.readFile(filePath, "utf-8");
        event = JSON.parse(raw);
    } catch (err) {
        console.error(`[deeplink] take-meeting-notes: failed to read ${filePath}`, err);
        return;
    }

    const payload = { event, openMeeting };

    if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => {
            win.webContents.send("app:takeMeetingNotes", payload);
        });
        return;
    }

    win.webContents.send("app:takeMeetingNotes", payload);
}

function focusWindow(win: BrowserWindow): void {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}
