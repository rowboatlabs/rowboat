import { spawn } from "node:child_process";
import type { MicProbe, MicUser } from "./types.js";

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

const PMSET_TIMEOUT_MS = 10_000;

// Run `pmset -g assertions` and resolve its stdout.
//
// We use spawn (not execFile) with stdin explicitly set to "ignore" because in
// a packaged .app launched from Finder — rather than a terminal — the main
// process has no valid stdin file descriptor. execFile would try to wire the
// child's stdio to that invalid fd, and since this runs repeatedly from the
// detector's background poll loop, the spawn fails with `EBADF` (errno -9).
// Setting stdio to ['ignore', 'pipe', 'pipe'] points the child's stdin at
// /dev/null, so no invalid descriptor is ever inherited. (This never surfaces
// in dev because launching from a terminal provides a valid stdin.)
function runPmsetAssertions(): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn("/usr/bin/pmset", ["-g", "assertions"], {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGKILL");
            reject(new Error(`pmset timed out after ${PMSET_TIMEOUT_MS}ms`));
        }, PMSET_TIMEOUT_MS);

        child.stdout?.on("data", (chunk) => { stdout += chunk; });
        child.stderr?.on("data", (chunk) => { stderr += chunk; });

        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });

        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`pmset exited with code ${code}: ${stderr.trim()}`));
            }
        });
    });
}

export class MacOsMicProbe implements MicProbe {
    async probe(): Promise<MicUser[]> {
        let stdout: string;
        try {
            stdout = await runPmsetAssertions();
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
