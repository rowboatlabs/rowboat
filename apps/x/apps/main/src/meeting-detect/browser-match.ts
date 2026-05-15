import { getWindowSnapshot } from "./foreground-window.js";

export type BrowserMeetingPlatform = "google-meet" | "zoom-web" | "teams-web" | "slack-huddle" | "webex-web";

export interface BrowserMeetingMatch {
    platform: BrowserMeetingPlatform;
    // Best-effort URL or tab title we matched on — useful for the popup copy.
    hint: string;
}

interface TitleRule {
    platform: BrowserMeetingPlatform;
    // Substrings checked against the (case-insensitive) window title / URL.
    needles: string[];
}

// Substrings we look for in the foreground window title (or URL when we
// have it). On Chrome/Edge/Firefox the page title is embedded in the window
// title, which is the most reliable cross-platform signal.
//   Meet page title:  "Meet - Daily Standup"  → matches "meet -"
//   Zoom web client:  "Zoom Meeting"         → matches "zoom meeting"
//   Teams web:        "<topic> | Microsoft Teams" → matches "microsoft teams"
const RULES: TitleRule[] = [
    { platform: "google-meet", needles: ["meet.google.com", "google meet", "meet -", "meet —", "meet |"] },
    { platform: "zoom-web", needles: ["zoom.us/j/", "zoom.us/wc/", "zoom meeting"] },
    { platform: "teams-web", needles: ["teams.microsoft.com", "microsoft teams"] },
    { platform: "slack-huddle", needles: ["app.slack.com", "slack huddle"] },
    { platform: "webex-web", needles: ["webex.com/meet", "webex.com/wbxmjs", "webex meeting"] },
];

/**
 * Look at the foreground window. If it's a browser and the title matches a
 * known meeting URL/platform, return a match. Returns null otherwise.
 *
 * Caller is expected to only invoke this when the detector classified the
 * mic-holder as `kind: "browser"`. That keeps active-win calls cheap — we
 * only ask the OS when there's a reason to ask.
 */
export async function matchBrowserMeeting(executable?: string): Promise<BrowserMeetingMatch | null> {
    const snap = await getWindowSnapshot(executable);
    if (!snap) return null;
    // Scan ALL known window titles — on Windows tasklist returns every window,
    // so even a backgrounded Meet tab still matches while Chrome holds the mic.
    for (const title of snap.titles) {
        const m = matchTitleOrUrl(title, undefined);
        if (m) return m;
    }
    return null;
}

/** Pure matcher — exposed for tests; no OS calls. */
export function matchTitleOrUrl(title: string | undefined, url: string | undefined): BrowserMeetingMatch | null {
    // active-win returns `url` on macOS for Chromium-family + Safari (Accessibility-perm gated).
    // On Windows, only `title` is reliable. Match against both.
    const haystack = `${url ?? ""}\n${title ?? ""}`.toLowerCase();
    if (!haystack.trim()) return null;

    for (const rule of RULES) {
        for (const needle of rule.needles) {
            if (haystack.includes(needle)) {
                return { platform: rule.platform, hint: url || title || "" };
            }
        }
    }
    return null;
}
