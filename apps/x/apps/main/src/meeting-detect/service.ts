import type { INotificationService } from "@x/core/dist/application/notification/service.js";
import { MeetingDetector, type MeetingActiveEvent } from "./detector.js";
import { matchBrowserMeeting, type BrowserMeetingMatch } from "./browser-match.js";
import { correlateNow, type CorrelatedEvent } from "./calendar-correlate.js";
import { Suppression } from "./suppression.js";
import type { MeetingAppKind } from "./meeting-apps.js";

// Glue layer: turns detector events into popup notifications, gated by browser
// tab matching, calendar correlation, and the suppression store.
//
// Tests inject their own detector + notification service + suppression so this
// runs without touching the OS.

type Matcher = () => Promise<BrowserMeetingMatch | null>;
type Correlator = (now: Date) => Promise<CorrelatedEvent | null>;

export interface MeetingDetectServiceOptions {
    detector: MeetingDetector;
    notifier: INotificationService;
    suppression: Suppression;
    // Defaults run the real OS-touching versions; tests override.
    matchBrowser?: Matcher;
    correlate?: Correlator;
}

export class MeetingDetectService {
    private readonly detector: MeetingDetector;
    private readonly notifier: INotificationService;
    private readonly suppression: Suppression;
    private readonly matchBrowser: Matcher;
    private readonly correlate: Correlator;
    // Track async work spawned from detector events so tests (and shutdown)
    // can wait for it to settle.
    private pending = new Set<Promise<void>>();

    constructor(opts: MeetingDetectServiceOptions) {
        this.detector = opts.detector;
        this.notifier = opts.notifier;
        this.suppression = opts.suppression;
        this.matchBrowser = opts.matchBrowser ?? matchBrowserMeeting;
        this.correlate = opts.correlate ?? ((now) => correlateNow(now));
    }

    async start(): Promise<void> {
        await this.suppression.init();
        if (!this.notifier.isSupported()) {
            console.warn("[MeetingDetect] notification service unsupported; detector will run but no popups will fire");
        }
        this.detector.on("meeting-active", (event) => {
            const work = this.handleActive(event).catch((err) => {
                console.error("[MeetingDetect] handleActive failed:", err);
            });
            this.pending.add(work);
            void work.finally(() => this.pending.delete(work));
        });
        this.detector.on("meeting-cleared", (event) => {
            // Mic released → drop the session's suppression so the next call
            // (same Chrome process, new Meet) can fire again.
            this.suppression.clearSession(event.sessionKey).catch((err) => {
                console.error("[MeetingDetect] clearSession failed:", err);
            });
            console.log(`[MeetingDetect] session cleared: ${event.sessionKey}`);
        });
        this.detector.start();
        console.log("[MeetingDetect] service started — polling for meeting apps holding the mic");
    }

    stop(): void {
        this.detector.stop();
    }

    /** Test hook — resolves once all in-flight handleActive() calls complete. */
    async settle(): Promise<void> {
        while (this.pending.size > 0) {
            await Promise.all([...this.pending]);
        }
    }

    private async handleActive(event: MeetingActiveEvent): Promise<void> {
        console.log(`[MeetingDetect] active: ${event.executable} (kind=${event.kind})`);
        if (!this.suppression.shouldNotify(event.sessionKey, event.executable)) {
            console.log(`[MeetingDetect] suppressed (already notified or muted): ${event.sessionKey}`);
            return;
        }

        // For browsers we MUST confirm the foreground tab is a meeting page —
        // otherwise we'd popup for YouTube, Spotify web, etc.
        let browserMatch: BrowserMeetingMatch | null = null;
        if (event.kind === "browser") {
            browserMatch = await this.matchBrowser();
            if (!browserMatch) return;
        }

        const correlated = await this.correlate(new Date()).catch(() => null);
        const payload = buildPopup(event.kind, browserMatch, correlated);
        if (!payload) return;

        try {
            this.notifier.notify(payload.notify);
            await this.suppression.markNotified(event.sessionKey);
            console.log(`[MeetingDetect] popup fired for ${event.executable} (kind=${event.kind}, eventId=${correlated?.eventId ?? "ad-hoc"})`);
        } catch (err) {
            console.error("[MeetingDetect] notify failed:", err);
        }
    }
}

interface BuiltPopup {
    notify: {
        title: string;
        message: string;
        link: string;
        actionLabel: string;
    };
}

export function buildPopup(
    kind: MeetingAppKind,
    browserMatch: BrowserMeetingMatch | null,
    correlated: CorrelatedEvent | null,
): BuiltPopup | null {
    const platformLabel = describePlatform(kind, browserMatch);
    if (!platformLabel) return null;

    if (correlated) {
        return {
            notify: {
                title: "Take notes for this meeting?",
                message: `${correlated.summary} — on ${platformLabel}. Click to capture notes with Rowboat.`,
                link: `rowboat://action?type=take-meeting-notes&eventId=${encodeURIComponent(correlated.eventId)}`,
                actionLabel: "Take notes",
            },
        };
    }

    // Ad-hoc — no calendar event matched. Still offer notes, with generic copy.
    return {
        notify: {
            title: "You're in a meeting",
            message: `Detected on ${platformLabel}. Click to take notes with Rowboat.`,
            link: `rowboat://action?type=take-meeting-notes&title=${encodeURIComponent(`Ad-hoc ${platformLabel} call`)}`,
            actionLabel: "Take notes",
        },
    };
}

function describePlatform(kind: MeetingAppKind, browserMatch: BrowserMeetingMatch | null): string | null {
    if (browserMatch) {
        switch (browserMatch.platform) {
            case "google-meet": return "Google Meet";
            case "zoom-web": return "Zoom";
            case "teams-web": return "Microsoft Teams";
            case "slack-huddle": return "Slack huddle";
            case "webex-web": return "Webex";
        }
    }
    switch (kind) {
        case "zoom": return "Zoom";
        case "teams": return "Microsoft Teams";
        case "slack": return "Slack";
        case "discord": return "Discord";
        case "webex": return "Webex";
        case "browser": return null; // shouldn't happen — caller bails before us when no browserMatch
        case "unknown": return null;
    }
}
