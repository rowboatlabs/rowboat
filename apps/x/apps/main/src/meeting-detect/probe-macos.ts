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
const ASSERTION_LINE = /^\s*pid\s+(\d+)\((.+?)\):\s+\[[^\]]+\]\s+\S+\s+(PreventUserIdle\w+)/;

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
}
