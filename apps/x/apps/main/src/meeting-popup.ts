import { app, BrowserWindow, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DetectedMeeting } from "@x/core/dist/meetings/detector.js";

/**
 * The "Meeting detected — Take Notes?" popup: a small frameless panel in the
 * top-left corner of the display the user is on. A macOS panel (NSPanel) at
 * screen-saver level with fullscreen-auxiliary behavior, so it floats over
 * whatever the user is looking at — including a fullscreen Meet/Zoom — and
 * appears without stealing focus. Auto-dismisses after a while and never
 * records anything by itself: clicking "Take Notes" hands off to the main
 * window's existing take-meeting-notes flow.
 */

// Lean bar + margins for the overhanging × and the CSS drop shadow.
const POPUP_WIDTH = 448;
const POPUP_HEIGHT = 96;
const AUTO_DISMISS_MS = 45_000;

// Display names, Granola-style ("Chrome", not "Google Chrome").
const SHORT_APP_NAMES: Record<string, string> = {
    "Google Chrome": "Chrome",
    "Microsoft Edge": "Edge",
    "Brave Browser": "Brave",
    "Microsoft Teams": "Teams",
};

export interface MeetingPopupPayload {
    title: string;
    message: string;
    hasCalendarEvent: boolean;
}

let popupWin: BrowserWindow | null = null;
let currentPayload: MeetingPopupPayload | null = null;
let currentMeeting: DetectedMeeting | null = null;
let dismissTimer: NodeJS.Timeout | null = null;
let onTakeNotes: ((meeting: DetectedMeeting) => void) | null = null;

/** Main registers the take-notes handoff once at startup. */
export function initMeetingPopup(handlers: { onTakeNotes: (meeting: DetectedMeeting) => void }): void {
    onTakeNotes = handlers.onTakeNotes;
}

export function getMeetingPopupPayload(): MeetingPopupPayload | null {
    return currentPayload;
}

export function handleMeetingPopupAction(action: "take-notes" | "dismiss"): void {
    const meeting = currentMeeting;
    closeMeetingPopup();
    if (action === "take-notes" && meeting) {
        onTakeNotes?.(meeting);
    }
}

export function closeMeetingPopup(): void {
    if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
    }
    currentPayload = null;
    currentMeeting = null;
    if (popupWin && !popupWin.isDestroyed()) popupWin.destroy();
    popupWin = null;
}

export function showMeetingPopup(meeting: DetectedMeeting): void {
    const eventSummary =
        typeof meeting.calendarEvent?.summary === "string"
            ? (meeting.calendarEvent.summary as string).trim()
            : "";
    const appLabel = SHORT_APP_NAMES[meeting.appName] ?? meeting.appName;
    const payload: MeetingPopupPayload = {
        // Lean two-liner: "Meeting detected" / "Chrome" — or the event name
        // over the platform when a calendar event is happening now.
        title: eventSummary ? eventSummary : meeting.title,
        message: appLabel,
        hasCalendarEvent: Boolean(meeting.calendarEvent),
    };

    // Replace any popup that's still up (stale detection loses to fresh).
    closeMeetingPopup();
    currentPayload = payload;
    currentMeeting = meeting;

    // Top-left of the display the user is actually on (cursor display), not
    // necessarily the primary one.
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const workArea = display.workArea;
    const popupDir = path.dirname(fileURLToPath(import.meta.url));
    const preloadPath = app.isPackaged
        ? path.join(popupDir, "../preload/dist/preload.js")
        : path.join(popupDir, "../../../preload/dist/preload.js");

    const win = new BrowserWindow({
        width: POPUP_WIDTH,
        height: POPUP_HEIGHT,
        x: workArea.x + 24,
        y: workArea.y + 24,
        // NSPanel (macOS): non-activating, and — unlike a regular window with
        // visibleOnFullScreen — can float over fullscreen Spaces without
        // turning Rowboat into an "agent" app that loses its Dock icon.
        ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
        frame: false,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        // Transparent window: the rounded card + overhanging × render inside;
        // the shadow is CSS (native shadows artifact on transparent windows).
        transparent: true,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: preloadPath,
        },
    });
    // Screen-saver level + fullscreen-auxiliary: visible over fullscreen
    // meeting apps on every workspace — the whole point of the popup is to be
    // seen while the user is IN the meeting, wherever that is.
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // visibleOnFullScreen flips the app's activation policy to "accessory":
    // the Dock icon disappears and the app can no longer take foreground
    // focus — clicking "Take Notes" then hands focus to whatever is next in
    // the window stack instead of Rowboat. Restore the policy immediately:
    // the popup keeps its fullscreen-auxiliary collection behavior (it's a
    // non-activating panel, same trick as Zoom's floating controls), while
    // Rowboat stays a regular app.
    if (process.platform === "darwin") {
        void app.dock?.show();
    }
    win.webContents.once("did-finish-load", () => {
        if (win.isDestroyed()) return;
        win.webContents.send("meetingDetect:payload", payload);
        // showInactive: the user is in a meeting app right now — appearing
        // must not steal focus from it.
        win.showInactive();
    });
    win.on("closed", () => {
        if (popupWin === win) popupWin = null;
    });
    popupWin = win;

    if (app.isPackaged) {
        win.loadURL("app://-/index.html#meeting-detected");
    } else {
        win.loadURL("http://localhost:5173/#meeting-detected");
    }

    dismissTimer = setTimeout(() => closeMeetingPopup(), AUTO_DISMISS_MS);
}
