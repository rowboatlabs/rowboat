import { describe, it, expect } from "vitest";
import { matchTitleOrUrl, pickBestMatch } from "./browser-match.js";

describe("matchTitleOrUrl", () => {
    it("matches Google Meet by URL", () => {
        const m = matchTitleOrUrl("Meet — Standup", "https://meet.google.com/abc-defg-hij");
        expect(m?.platform).toBe("google-meet");
    });

    it("matches Google Meet by window title alone (Windows/Mac no-URL case)", () => {
        const m = matchTitleOrUrl("Meet - Daily Standup - Google Chrome", undefined);
        expect(m?.platform).toBe("google-meet");
    });

    it("matches Meet with em-dash variant (locale-dependent title)", () => {
        const m = matchTitleOrUrl("Meet — Daily Standup", undefined);
        expect(m?.platform).toBe("google-meet");
    });

    it("matches Zoom web client", () => {
        const m = matchTitleOrUrl("Zoom Meeting", "https://us02web.zoom.us/j/123456789");
        expect(m?.platform).toBe("zoom-web");
    });

    it("matches Teams web on a real meeting (meetup-join) URL", () => {
        const m = matchTitleOrUrl("Meeting | Microsoft Teams", "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc");
        expect(m?.platform).toBe("teams-web");
    });

    it("ignores random YouTube tab", () => {
        const m = matchTitleOrUrl("Mock Interview - YouTube", "https://www.youtube.com/watch?v=abc");
        expect(m).toBeNull();
    });

    // Tightened rules — being open is not being in a call (issue #562 follow-up).
    it("does NOT match a plain Slack tab (DM/channel open, no huddle)", () => {
        const m = matchTitleOrUrl("Gagan (DM) - rowboat - Slack", "https://app.slack.com/client/T077R8M5U94/D0B77701AN7");
        expect(m).toBeNull();
    });

    it("matches a Slack huddle by its title marker", () => {
        const m = matchTitleOrUrl("Huddle in general - rowboat - Slack", "https://app.slack.com/client/T077/C123");
        expect(m?.platform).toBe("slack-huddle");
    });

    it("does NOT match a Teams calendar/chat tab (no meetup-join)", () => {
        const m = matchTitleOrUrl("Calendar | Microsoft Teams", "https://teams.microsoft.com/_#/calendarv2");
        expect(m).toBeNull();
    });

    it("returns null for empty input", () => {
        expect(matchTitleOrUrl(undefined, undefined)).toBeNull();
        expect(matchTitleOrUrl("", "")).toBeNull();
    });

    it("is case-insensitive", () => {
        const m = matchTitleOrUrl("ZOOM MEETING", "https://ZOOM.US/J/999");
        expect(m?.platform).toBe("zoom-web");
    });
});

describe("pickBestMatch", () => {
    // Verbatim tab set from the live session in issue #562: a Slack DM tab sat
    // in front of the real Google Meet call. The old first-match logic labeled
    // the popup "Slack huddle"; priority must now pick Google Meet — and the
    // plain Slack tab must not match at all under the tightened rules.
    const LIVE_TABS = [
        "https://www.coursera.org/learn/dao-3022/lecture/3d0S8/benchmarking-evaluation-part-1",
        "Benchmarking & Evaluation- Part 1 | Coursera",
        "https://www.youtube.com/watch?v=qt2XslRMOto",
        "(58) Inside India's Wealth Gap ... - YouTube",
        "https://app.slack.com/client/T077R8M5U94/D0B77701AN7",
        "Gagan (DM) - rowboat - Slack",
        "https://github.com/rowboatlabs/rowboat/pull/562",
        "feat: detect meeting joins ... · Pull Request #562",
        "https://mail.google.com/mail/u/0/?tab=rm&ogbl#inbox",
        "Inbox (4,067) - prakhar9999pandey@gmail.com - Gmail",
        "https://meet.google.com/uaz-funz-pvy?authuser=0",
        "Meet – uaz-funz-pvy",
    ];

    it("picks Google Meet over a backgrounded plain Slack tab (the #562 bug)", () => {
        const m = pickBestMatch(LIVE_TABS);
        expect(m?.platform).toBe("google-meet");
        expect(m?.hint).toContain("meet.google.com/uaz-funz-pvy");
    });

    it("prioritizes google-meet over a genuine slack-huddle when both are open", () => {
        const m = pickBestMatch([
            "Huddle in general - rowboat - Slack",
            "https://meet.google.com/abc-defg-hij",
        ]);
        expect(m?.platform).toBe("google-meet");
    });

    it("still returns the slack-huddle when it is the only meeting tab", () => {
        const m = pickBestMatch([
            "Inbox - Gmail",
            "Huddle in general - rowboat - Slack",
        ]);
        expect(m?.platform).toBe("slack-huddle");
    });

    it("returns null when no tab is an actual meeting", () => {
        expect(pickBestMatch([
            "Gagan (DM) - rowboat - Slack",
            "Calendar | Microsoft Teams",
            "Inbox - Gmail",
        ])).toBeNull();
    });
});
