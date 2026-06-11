import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MicProbe, MicUser } from "./types.js";

const execFileAsync = promisify(execFile);

// macOS doesn't expose a public "who is using the mic right now" API. Two
// pragmatic signals we can read from a shell without a native helper:
//
//   1. `pmset -g assertions` — apps in a video call almost always hold a
//      PreventUserIdleDisplaySleep wake-lock to keep the screen on. Strong
//      proxy for "active call." False positives: video playback (YouTube,
//      Netflix) — Phase 2's tab-title check filters those out for browsers.
//
//   2. `lsof | grep coreaudiod` — clients connected to coreaudiod. Noisy and
//      doesn't always include the mic user, so we prefer pmset as primary.
//
// Output format from `pmset -g assertions`:
//   pid 4711(zoom.us): [0x00000ff...] 00:23:14 PreventUserIdleDisplaySleep named: "..."
//   pid 664(Google Chrome): [0x...] 00:00:59 NoIdleSleepAssertion named: "WebRTC has active PeerConnections"
//
// We key on two assertion types:
//   - PreventUserIdleDisplaySleep — native meeting apps keep the screen on
//     during a call. We deliberately do NOT match PreventUserIdleSystemSleep,
//     which is held by `caffeinate`, `powerd`, downloads, etc. (noise).
//   - NoIdleSleepAssertion — browsers (Chrome/Arc/Safari/etc.) hold this with
//     the reason "WebRTC has active PeerConnections" whenever a WebRTC call is
//     live (Google Meet, Zoom web, Teams web, Discord, Slack huddles). This is
//     the most reliable browser-meeting signal. False positives (e.g. a WebRTC
//     YouTube tab) are filtered downstream by browser-match's tab-title check.
const ASSERTION_LINE = /^\s*pid\s+(\d+)\((.+?)\):\s+\[[^\]]+\]\s+\S+\s+(PreventUserIdleDisplaySleep|NoIdleSleepAssertion)/;

export class MacOsMicProbe implements MicProbe {
    async probe(): Promise<MicUser[]> {
        let stdout: string;
        try {
            const result = await execFileAsync("/usr/bin/pmset", ["-g", "assertions"], {
                timeout: 10_000,
            });
            stdout = result.stdout;
        } catch (err) {
            console.error("[MeetingDetect] macOS probe failed:", err);
            return [];
        }

        return parseAssertions(stdout);
    }
}

/**
 * Parse `pmset -g assertions` stdout into the distinct processes holding a
 * meeting-relevant assertion. Pure (no OS calls) so it's unit-testable against
 * captured pmset output. One entry per pid; the first matching line wins.
 */
export function parseAssertions(stdout: string): MicUser[] {
    const seen = new Map<number, MicUser>();
    for (const line of stdout.split("\n")) {
        const m = ASSERTION_LINE.exec(line);
        if (!m) continue;
        const pid = Number(m[1]);
        const command = m[2].trim();
        if (!Number.isFinite(pid)) continue;
        if (seen.has(pid)) continue;
        seen.set(pid, { executable: command, pid });
    }
    return Array.from(seen.values());
}
