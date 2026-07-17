import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { WorkDir } from "../config/config.js";
import { isNotificationCategoryEnabled } from "../config/notification_config.js";

/**
 * Ambient meeting detection (Granola-style).
 *
 * Signal: the mic-monitor helper (apps/main/native/mic-monitor.swift) reports
 * when ANY process starts using the microphone — with the owning processes'
 * bundle IDs and executable paths on macOS 14.4+, resolved natively in the
 * helper. That matters twice over: attribution is exact (a Meet call in
 * Chrome attributes to Chrome even while Slack/Zoom idle in the background),
 * and the main process never has to shell out while capture is active
 * (child-process spawns from Electron's main fail with EBADF during capture).
 *
 * When the mic has been in use continuously for a few seconds — and it isn't
 * Rowboat's own capture — we label the popup ("Huddle detected" for Slack,
 * "Call detected" for FaceTime/WhatsApp, "Meeting detected" otherwise),
 * merge with a calendar event whose window covers now (start − 15 min
 * through end), and emit a DetectedMeeting. Never auto-records: the consumer
 * (main process) shows a "Take Notes?" popup and waits for a click.
 *
 * Fires at most once per continuous mic-in-use session; the session resets
 * after the mic has been idle for MIC_SESSION_RESET_MS.
 *
 * While Rowboat records, the same owner list powers call-end detection: once
 * a meeting app has been seen on the mic, its absence for CALL_END_GRACE_MS
 * means the call ended.
 */

// 1s so call-end lands within ~2s of hang-up; all tick work is in-memory
// (the helper pushes owner updates, nothing is spawned).
const POLL_INTERVAL_MS = 1_000;
// Mic must be in use continuously this long before we prompt — filters out
// Siri, dictation bursts, and app mic-permission probes.
const MIC_DEBOUNCE_MS = 5_000;
// Mic idle this long ends the "session" and re-arms the prompt.
const MIC_SESSION_RESET_MS = 30_000;
// A calendar event merges with a detected call from 15 min before its start
// (Granola merges ad-hoc calls within 15 minutes of a scheduled event).
const CALENDAR_MERGE_LEAD_MS = 15 * 60_000;
// While recording, the meeting app must be off the mic this long before we
// call the meeting over. Kept short so notes arrive right after hang-up;
// only guards against sub-poll device churn, not full reconnects.
const CALL_END_GRACE_MS = 1_000;
const CALENDAR_SYNC_DIR = path.join(WorkDir, "calendar_sync");
const HELPER_MAX_RESTARTS = 3;

export type DetectedMeetingKind = "huddle" | "call" | "meeting";

export interface DetectedMeeting {
    kind: DetectedMeetingKind;
    /** Popup title, Granola wording: "Huddle detected" / "Call detected" / "Meeting detected". */
    title: string;
    /** Human label of the app that likely owns the call, e.g. "Slack", "Zoom", "Google Chrome". */
    appName: string;
    /** Suggested note title when no calendar event matched, e.g. "Slack huddle". */
    noteTitle: string;
    /** Raw calendar event JSON when a nearby event matched. */
    calendarEvent?: Record<string, unknown>;
}

interface PlatformMatch {
    app: string;
    kind: DetectedMeetingKind;
}

// Bundle-ID prefixes (lowercased) → platform. The primary matcher: exact and
// stable, covers helper processes too (com.google.Chrome.helper etc.).
const BUNDLE_MATCHERS: Array<{ prefix: string; app: string; kind: DetectedMeetingKind }> = [
    { prefix: "us.zoom", app: "Zoom", kind: "meeting" },
    { prefix: "com.microsoft.teams", app: "Microsoft Teams", kind: "meeting" },
    { prefix: "com.cisco.webex", app: "Webex", kind: "meeting" },
    { prefix: "com.webex", app: "Webex", kind: "meeting" },
    { prefix: "com.tinyspeck.slackmacgap", app: "Slack", kind: "huddle" },
    { prefix: "com.apple.facetime", app: "FaceTime", kind: "call" },
    { prefix: "net.whatsapp", app: "WhatsApp", kind: "call" },
    { prefix: "com.hnc.discord", app: "Discord", kind: "call" },
    // Browsers — generic "Meeting detected".
    { prefix: "com.google.chrome", app: "Google Chrome", kind: "meeting" },
    { prefix: "com.apple.safari", app: "Safari", kind: "meeting" },
    { prefix: "com.apple.webkit", app: "Safari", kind: "meeting" },
    { prefix: "org.mozilla.firefox", app: "Firefox", kind: "meeting" },
    { prefix: "com.brave.browser", app: "Brave Browser", kind: "meeting" },
    { prefix: "com.microsoft.edgemac", app: "Microsoft Edge", kind: "meeting" },
    { prefix: "company.thebrowser", app: "Arc", kind: "meeting" },
];

// Rowboat's own capture (and the dev Electron shell) — never a "meeting".
const SELF_BUNDLE_PREFIXES = ["com.rowboat", "com.github.electron"];

const BROWSER_APPS = new Set([
    "Google Chrome",
    "Safari",
    "Firefox",
    "Brave Browser",
    "Microsoft Edge",
    "Arc",
]);

// Process-name fallbacks (case-insensitive prefix on the executable
// basename): used when an owner has no bundle ID, and by the pre-14.4
// running-app heuristic. Ordered by confidence for the heuristic.
const MEETING_APPS: Array<{ proc: string; app: string; kind: DetectedMeetingKind }> = [
    { proc: "zoom.us", app: "Zoom", kind: "meeting" },
    { proc: "MSTeams", app: "Microsoft Teams", kind: "meeting" },
    { proc: "Microsoft Teams", app: "Microsoft Teams", kind: "meeting" },
    { proc: "Webex", app: "Webex", kind: "meeting" },
    { proc: "FaceTime", app: "FaceTime", kind: "call" },
    { proc: "WhatsApp", app: "WhatsApp", kind: "call" },
    { proc: "Slack", app: "Slack", kind: "huddle" },
    { proc: "Discord", app: "Discord", kind: "call" },
];

const BROWSERS = [
    "Google Chrome",
    "Safari",
    "Arc",
    "Brave Browser",
    "Microsoft Edge",
    "Firefox",
    "Dia",
    "Comet",
];

const KIND_TITLES: Record<DetectedMeetingKind, string> = {
    huddle: "Huddle detected",
    call: "Call detected",
    meeting: "Meeting detected",
};

interface MicOwner {
    pid: number;
    bundleId: string;
    path: string;
}

interface DetectorOptions {
    /** Absolute path to the compiled mic-monitor helper binary. */
    helperPath: string;
    onDetected: (meeting: DetectedMeeting) => void;
    /**
     * Fired once per recording session when the meeting app that was on the
     * mic has released it for CALL_END_GRACE_MS while Rowboat is still
     * capturing — i.e. the call ended. Needs per-process attribution
     * (macOS 14.4+); silently unavailable otherwise.
     */
    onExternalCallEnded?: () => void;
}

let started = false;
let selfCaptureActive = false;
let micInUse = false;
// Processes currently capturing from the mic (macOS 14.4+; empty = unknown).
let micOwners: MicOwner[] = [];
let micInUseSince: number | null = null;
let micIdleSince: number | null = null;
let sessionNotified = false;
let helperRestarts = 0;
// Call-end tracking for the current self-capture session.
let externalAppSeen = false;
let externalAbsentSince: number | null = null;
let callEndFired = false;

/**
 * Rowboat's own capture (meeting recording, assistant voice/video call) also
 * flips the mic-in-use signal — the consumer reports it here so we never
 * prompt about our own audio.
 */
export function setSelfCaptureActive(active: boolean): void {
    selfCaptureActive = active;
    // Fresh capture session — re-arm call-end tracking.
    externalAppSeen = false;
    externalAbsentSince = null;
    callEndFired = false;
    if (active) {
        // Whatever mic session is in flight is ours — don't prompt when the
        // user stops and the mic lingers.
        sessionNotified = true;
    }
}

export function init(options: DetectorOptions): void {
    if (started) return;
    if (process.platform !== "darwin") return;
    if (!existsSync(options.helperPath)) {
        console.warn(
            `[MeetingDetect] mic-monitor helper not found at ${options.helperPath} — ambient detection disabled`,
        );
        return;
    }
    started = true;
    console.log("[MeetingDetect] starting ambient meeting detection");

    spawnHelper(options.helperPath);
    setInterval(() => {
        try {
            tick(options.onDetected);
            checkExternalCallEnd(options.onExternalCallEnded);
        } catch (err) {
            console.error("[MeetingDetect] tick failed:", err);
        }
    }, POLL_INTERVAL_MS);
}

function spawnHelper(helperPath: string): void {
    let child: ReturnType<typeof spawn>;
    try {
        child = spawn(helperPath, [], { stdio: ["pipe", "pipe", "ignore"] });
    } catch (err) {
        console.error("[MeetingDetect] failed to spawn mic-monitor:", err);
        return;
    }

    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;
            try {
                const parsed = JSON.parse(line);
                if (typeof parsed?.micInUse === "boolean") {
                    micInUse = parsed.micInUse;
                    micOwners = Array.isArray(parsed.owners)
                        ? parsed.owners.filter(
                              (o: unknown): o is MicOwner =>
                                  typeof (o as MicOwner)?.pid === "number" &&
                                  typeof (o as MicOwner)?.bundleId === "string" &&
                                  typeof (o as MicOwner)?.path === "string",
                          )
                        : [];
                }
            } catch {
                // Ignore malformed lines.
            }
        }
    });

    child.on("exit", (code) => {
        micInUse = false;
        micOwners = [];
        if (helperRestarts < HELPER_MAX_RESTARTS) {
            helperRestarts += 1;
            const delay = 5_000 * helperRestarts;
            console.warn(
                `[MeetingDetect] mic-monitor exited (code ${code}); restart ${helperRestarts}/${HELPER_MAX_RESTARTS} in ${delay / 1000}s`,
            );
            setTimeout(() => spawnHelper(helperPath), delay);
        } else {
            console.error("[MeetingDetect] mic-monitor kept exiting — ambient detection disabled");
        }
    });
    child.on("error", (err) => {
        console.error("[MeetingDetect] mic-monitor error:", err);
    });
}

/**
 * Is the mic being used by something that could be a meeting? With owner
 * attribution (macOS 14.4+), only call-capable owners count — system daemons
 * like corespeechd ("Hey Siri" keeps a permanent low-power mic tap open),
 * dictation, or audio recorders neither start the detection debounce nor
 * claim the once-per-session slot. Keying the session on raw mic-in-use
 * shipped a bug where Siri's always-on tap claimed the session at launch and
 * never released it, so real meetings never prompted. Without attribution,
 * fall back to raw device state.
 */
function meetingRelevantMicInUse(): boolean {
    if (!micInUse) return false;
    if (micOwners.length === 0) return true;
    return micOwners.some((owner) => {
        const match = matchOwner(owner);
        return match !== null && match !== "self";
    });
}

function tick(onDetected: DetectorOptions["onDetected"]): void {
    const now = Date.now();

    if (!meetingRelevantMicInUse()) {
        micInUseSince = null;
        if (micIdleSince === null) micIdleSince = now;
        if (sessionNotified && now - micIdleSince >= MIC_SESSION_RESET_MS) {
            sessionNotified = false;
        }
        return;
    }

    micIdleSince = null;
    if (micInUseSince === null) micInUseSince = now;
    if (sessionNotified) return;
    if (selfCaptureActive) {
        // Mark the session as handled so a call that started as ours doesn't
        // prompt the moment our capture stops while the meeting app holds on.
        sessionNotified = true;
        return;
    }
    if (now - micInUseSince < MIC_DEBOUNCE_MS) return;

    // Claim the session before the async work — a slow calendar scan must
    // not let a second tick double-fire.
    sessionNotified = true;
    void detect(onDetected);
}

/**
 * While Rowboat is recording, watch whether any known meeting app/browser
 * still owns the mic. Once one has been seen, its absence for
 * CALL_END_GRACE_MS means the call ended — fire once per session. Fully
 * synchronous: reads the helper-provided owner list, spawns nothing.
 */
function checkExternalCallEnd(onExternalCallEnded?: () => void): void {
    if (!onExternalCallEnded) return;
    if (!selfCaptureActive || callEndFired) return;
    // No attribution data (pre-14.4 macOS) — feature unavailable.
    if (micOwners.length === 0) return;

    const now = Date.now();
    const externalOnMic = micOwners.some((owner) => {
        const match = matchOwner(owner);
        return match !== null && match !== "self";
    });
    if (externalOnMic) {
        if (!externalAppSeen) {
            console.log(
                `[MeetingDetect] call-end watch armed — mic owners: ${describeOwners(micOwners)}`,
            );
        }
        externalAppSeen = true;
        externalAbsentSince = null;
        return;
    }
    if (!externalAppSeen) return;
    if (externalAbsentSince === null) {
        externalAbsentSince = now;
        console.log(
            `[MeetingDetect] meeting app off the mic — remaining owners: ${describeOwners(micOwners)}`,
        );
        return;
    }
    if (now - externalAbsentSince >= CALL_END_GRACE_MS) {
        callEndFired = true;
        console.log("[MeetingDetect] meeting app released the mic — call likely ended");
        onExternalCallEnded();
    }
}

function describeOwners(owners: MicOwner[]): string {
    return owners
        .map((o) => o.bundleId || path.basename(o.path) || `pid ${o.pid}`)
        .join(", ");
}

async function detect(onDetected: DetectorOptions["onDetected"]): Promise<void> {
    if (!isNotificationCategoryEnabled("meeting_detection")) return;

    const source = await findLikelyMeetingApp();
    if (!source) {
        // Mic in use but nothing call-capable owns it (dictation, voice
        // memo, unknown recorder) — stay quiet to avoid noise.
        return;
    }

    const calendarEvent = await findNearbyCalendarEvent();
    const eventSummary =
        typeof calendarEvent?.summary === "string" ? calendarEvent.summary.trim() : "";

    const meeting: DetectedMeeting = {
        kind: source.kind,
        title: KIND_TITLES[source.kind],
        appName: source.app,
        noteTitle: eventSummary || defaultNoteTitle(source),
        ...(calendarEvent ? { calendarEvent } : {}),
    };

    console.log(
        `[MeetingDetect] ${meeting.title} (app: ${meeting.appName}` +
        (eventSummary ? `, calendar: "${eventSummary}")` : ")"),
    );
    onDetected(meeting);
}

function defaultNoteTitle(source: PlatformMatch): string {
    if (source.kind === "huddle") return `${source.app} huddle`;
    if (source.kind === "call") return `${source.app} call`;
    return BROWSER_APPS.has(source.app) || BROWSERS.includes(source.app)
        ? "Meeting"
        : `${source.app} meeting`;
}

/** Match a mic owner to a platform (or to Rowboat itself). */
function matchOwner(owner: MicOwner): PlatformMatch | "self" | null {
    const bundle = owner.bundleId.toLowerCase();
    if (bundle) {
        for (const prefix of SELF_BUNDLE_PREFIXES) {
            if (bundle.startsWith(prefix)) return "self";
        }
        for (const matcher of BUNDLE_MATCHERS) {
            if (bundle.startsWith(matcher.prefix)) {
                return { app: matcher.app, kind: matcher.kind };
            }
        }
    }
    const basename = path.basename(owner.path);
    return basename ? matchProcessName(basename) : null;
}

/** Match one process name to a platform, by case-insensitive prefix. */
function matchProcessName(name: string): PlatformMatch | null {
    const lower = name.toLowerCase();
    // Safari captures through WebKit's out-of-process media stack.
    if (lower.startsWith("com.apple.webkit")) return { app: "Safari", kind: "meeting" };
    // Firefox media capture lives in plugin-container.
    if (lower.startsWith("plugin-container")) return { app: "Firefox", kind: "meeting" };
    for (const candidate of MEETING_APPS) {
        if (lower.startsWith(candidate.proc.toLowerCase())) {
            return { app: candidate.app, kind: candidate.kind };
        }
    }
    for (const browser of BROWSERS) {
        if (lower.startsWith(browser.toLowerCase())) return { app: browser, kind: "meeting" };
    }
    return null;
}

/**
 * Attribute the call to an app. Exact when mic owners are known (bundle IDs
 * from the helper, no child processes involved). Owners known but none
 * call-capable (voice memo, dictation, screen recorder) → NOT a meeting,
 * stay quiet. Only without attribution (pre-14.4 macOS) fall back to the
 * running-app heuristic.
 */
async function findLikelyMeetingApp(): Promise<PlatformMatch | null> {
    if (micOwners.length > 0) {
        const matches = micOwners
            .map(matchOwner)
            .filter((m): m is PlatformMatch => m !== null && m !== "self");
        // Prefer dedicated apps over browsers when several own the mic.
        const dedicated = matches.find((m) => !BROWSER_APPS.has(m.app));
        return dedicated ?? matches[0] ?? null;
    }

    // No attribution available — running-app heuristic in table order
    // (dedicated conferencing apps beat always-running chat apps beat browsers).
    const names = await runningProcessNames();
    if (!names) return null;
    const hasPrefix = (prefix: string) => {
        const lower = prefix.toLowerCase();
        for (const name of names) {
            if (name.toLowerCase().startsWith(lower)) return true;
        }
        return false;
    };
    for (const candidate of MEETING_APPS) {
        if (hasPrefix(candidate.proc)) return { app: candidate.app, kind: candidate.kind };
    }
    for (const browser of BROWSERS) {
        if (hasPrefix(browser)) return { app: browser, kind: "meeting" };
    }
    return null;
}

function runningProcessNames(): Promise<Set<string> | null> {
    return new Promise((resolve) => {
        execFile("ps", ["-axo", "comm="], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            const names = new Set<string>();
            for (const line of stdout.split("\n")) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                // GUI apps list as full executable paths — match the basename.
                names.add(path.basename(trimmed));
            }
            resolve(names);
        });
    });
}

interface CalendarEvent {
    status?: string;
    summary?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    attendees?: Array<{ self?: boolean; responseStatus?: string }>;
    [key: string]: unknown;
}

/**
 * The calendar event (if any) whose window covers "now": from 15 minutes
 * before its start through its end. Skips all-day, cancelled, and
 * self-declined events. Ties go to the event that started most recently.
 */
async function findNearbyCalendarEvent(): Promise<CalendarEvent | null> {
    let files: string[];
    try {
        files = await fs.readdir(CALENDAR_SYNC_DIR);
    } catch {
        return null;
    }

    const now = Date.now();
    let best: { event: CalendarEvent; startMs: number } | null = null;

    for (const name of files) {
        if (!name.endsWith(".json") || name.startsWith("sync_state")) continue;
        let event: CalendarEvent;
        try {
            event = JSON.parse(await fs.readFile(path.join(CALENDAR_SYNC_DIR, name), "utf-8"));
        } catch {
            continue;
        }
        if (event.status === "cancelled") continue;
        const startStr = event.start?.dateTime;
        if (!startStr) continue; // all-day
        const self = event.attendees?.find((a) => a.self);
        if (self?.responseStatus === "declined") continue;

        const startMs = Date.parse(startStr);
        if (!Number.isFinite(startMs)) continue;
        const endStr = event.end?.dateTime;
        const endMs = endStr ? Date.parse(endStr) : startMs + 60 * 60_000;

        if (now < startMs - CALENDAR_MERGE_LEAD_MS || now > endMs) continue;
        if (!best || startMs > best.startMs) best = { event, startMs };
    }

    return best?.event ?? null;
}
