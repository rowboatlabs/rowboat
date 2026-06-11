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

// Substrings that indicate the user is ACTIVELY IN A CALL — not merely that the
// app happens to be open in a tab. Bare domains ("app.slack.com",
// "teams.microsoft.com") match any Slack DM or Teams calendar tab, so we require
// call-specific URL paths or title markers instead.
//   Meet:   meeting URLs are meet.google.com/<code>; title "Meet - <name>".
//   Zoom:   web client lives at zoom.us/j/<id> or zoom.us/wc/<id>.
//   Teams:  a live meeting join URL contains "meetup-join" (teams.microsoft.com
//           or teams.live.com); the bare domain (calendar, chat) does not.
//   Slack:  a huddle shows "huddle" in the tab title; a plain Slack tab does not.
//   Webex:  meeting URLs contain webex.com/meet or /wbxmjs.
const RULES: TitleRule[] = [
    { platform: "google-meet", needles: ["meet.google.com/", "google meet", "meet -", "meet —", "meet |"] },
    { platform: "zoom-web", needles: ["zoom.us/j/", "zoom.us/wc/", "zoom meeting"] },
    { platform: "teams-web", needles: ["meetup-join", "teams.live.com/meet"] },
    { platform: "webex-web", needles: ["webex.com/meet", "webex.com/wbxmjs", "webex meeting"] },
    { platform: "slack-huddle", needles: ["huddle"] },
];

// When several tabs match different platforms (e.g. a Slack DM open behind the
// real Google Meet call), prefer the more definitive meeting. Dedicated meeting
// platforms outrank a Slack huddle, whose "huddle" title marker is the weakest
// signal. Lower index = higher precedence.
const PLATFORM_PRIORITY: BrowserMeetingPlatform[] = [
    "google-meet",
    "zoom-web",
    "teams-web",
    "webex-web",
    "slack-huddle",
];

/**
 * Look at the browser's open tabs/windows. If any matches a known meeting
 * URL/platform, return the highest-priority match. Returns null otherwise.
 *
 * Caller is expected to only invoke this when the detector classified the
 * mic-holder as `kind: "browser"`. That keeps active-win calls cheap — we
 * only ask the OS when there's a reason to ask.
 */
export async function matchBrowserMeeting(executable?: string): Promise<BrowserMeetingMatch | null> {
    const snap = await getWindowSnapshot(executable);
    if (!snap) return null;
    return pickBestMatch(snap.titles);
}

/**
 * Scan every tab title/URL, collect matches, and return the highest-priority
 * one — not just the first tab that matches. This prevents a backgrounded Slack
 * DM from beating the real Google Meet call to the result. Pure; exposed for tests.
 */
export function pickBestMatch(titles: string[]): BrowserMeetingMatch | null {
    let best: BrowserMeetingMatch | null = null;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const title of titles) {
        const m = matchTitleOrUrl(title, undefined);
        if (!m) continue;
        const rank = PLATFORM_PRIORITY.indexOf(m.platform);
        if (rank < bestRank) {
            best = m;
            bestRank = rank;
            if (rank === 0) break; // nothing outranks the top platform
        }
    }
    return best;
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
