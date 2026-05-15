import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/dist/config/config.js";

// Ad-hoc meeting titles: "Meeting Notes - <Platform>" with a per-day counter
// suffix when there's already one for the same platform on the same day.
//
//   first Zoom today  → "Meeting Notes - Zoom"
//   second Zoom today → "Meeting Notes - Zoom #2"
//   first Zoom tomorrow → "Meeting Notes - Zoom"  (fresh folder, fresh count)

const MEETINGS_ROOT = path.join(WorkDir, "knowledge", "Meetings", "rowboat");
const TITLE_PREFIX = "Meeting Notes - ";

export interface AdHocTitleOptions {
    platformLabel: string;
    now?: Date;
    // Override for tests; defaults to the user's real meetings folder.
    root?: string;
}

export async function buildAdHocTitle(opts: AdHocTitleOptions): Promise<string> {
    const platform = opts.platformLabel;
    const base = `${TITLE_PREFIX}${platform}`;

    const now = opts.now ?? new Date();
    const dayFolder = path.join(opts.root ?? MEETINGS_ROOT, formatDay(now));

    const existing = await countMatching(dayFolder, base);
    if (existing === 0) return base;
    return `${base} #${existing + 1}`;
}

function formatDay(d: Date): string {
    // YYYY-MM-DD in local time — matches the existing knowledge/Meetings/rowboat layout.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

async function countMatching(dir: string, baseTitle: string): Promise<number> {
    let entries: string[];
    try {
        entries = await fs.readdir(dir);
    } catch {
        return 0;
    }
    const needle = normalize(baseTitle);
    let count = 0;
    for (const name of entries) {
        if (!name.endsWith(".md")) continue;
        const stem = name.slice(0, -3); // strip .md
        if (normalize(stem).startsWith(needle)) count++;
    }
    return count;
}

/**
 * Normalize a title or filename to alphanumerics-only-lowercase so we can
 * compare across slugification rules:
 *   "Meeting Notes - Zoom"      → "meetingnoteszoom"
 *   "Meeting_Notes_-_Zoom.md"   → "meetingnoteszoom"  (after .md strip)
 *   "Meeting Notes - Zoom #2"   → "meetingnoteszoom2"
 *
 * Anchoring with startsWith() then catches both the bare title and any
 * counter-suffixed variant, without colliding across platforms ("Meet"
 * vs "Zoom" stay distinct because the platform name appears after the
 * common "meetingnotes" prefix).
 */
function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Map our internal platform/kind names to user-facing short labels.
// Re-exported so service.ts can produce both the popup body label and the
// note title from the same source of truth.
export function shortPlatformLabel(input: {
    browserPlatform?: "google-meet" | "zoom-web" | "teams-web" | "slack-huddle" | "webex-web";
    kind: "zoom" | "teams" | "slack" | "discord" | "webex" | "browser" | "unknown";
}): string | null {
    if (input.browserPlatform) {
        switch (input.browserPlatform) {
            case "google-meet": return "Meet";
            case "zoom-web": return "Zoom";
            case "teams-web": return "Teams";
            case "slack-huddle": return "Slack";
            case "webex-web": return "Webex";
        }
    }
    switch (input.kind) {
        case "zoom": return "Zoom";
        case "teams": return "Teams";
        case "slack": return "Slack";
        case "discord": return "Discord";
        case "webex": return "Webex";
        case "browser":
        case "unknown":
            return null;
    }
}
