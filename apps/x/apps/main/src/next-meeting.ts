import path from "node:path";
import fs from "node:fs/promises";
import { WorkDir } from "@x/core/dist/config/config.js";
import { hasTray, setTrayNextMeeting, type TrayNextMeeting } from "./tray.js";

/**
 * Feeds the tray's next-meeting countdown: every 30 seconds, scan the synced
 * primary-calendar events for the soonest timed meeting that hasn't ended,
 * looking up to 12 hours out. Primary only on purpose — secondary calendars
 * (holidays, teammates) shouldn't ring the menu bar.
 */

const SYNC_DIR = path.join(WorkDir, "calendar_sync");
const POLL_MS = 30 * 1000;
const LOOKAHEAD_MS = 12 * 60 * 60 * 1000;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

type RawEvent = {
  id?: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  location?: string;
  description?: string;
};

const CONFERENCE_URL_RE =
  /https?:\/\/[^\s<>"']*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)[^\s<>"']*/i;

function extractConferenceLink(event: RawEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video" && e.uri);
  if (video?.uri) return video.uri;
  for (const text of [event.location, event.description]) {
    const match = text ? CONFERENCE_URL_RE.exec(text) : null;
    if (match) return match[0];
  }
  return null;
}

async function scanNextMeeting(): Promise<TrayNextMeeting | null> {
  let files: string[];
  try {
    files = await fs.readdir(SYNC_DIR);
  } catch {
    return null; // no sync dir yet (calendar not connected)
  }

  const now = Date.now();
  let best: TrayNextMeeting | null = null;
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    if (name === "calendars.json" || name === "composio_state.json" || name.startsWith("sync_state")) continue;

    let event: RawEvent;
    try {
      event = JSON.parse(await fs.readFile(path.join(SYNC_DIR, name), "utf-8"));
    } catch {
      continue;
    }

    if (event.status === "cancelled") continue;
    const startStr = event.start?.dateTime;
    if (!startStr) continue; // all-day
    if (event.attendees?.find((a) => a.self)?.responseStatus === "declined") continue;
    const startMs = Date.parse(startStr);
    if (!Number.isFinite(startMs)) continue;
    const endParsed = event.end?.dateTime ? Date.parse(event.end.dateTime) : NaN;
    const endMs = Number.isFinite(endParsed) ? endParsed : startMs + DEFAULT_DURATION_MS;
    if (endMs <= now) continue; // already over
    if (startMs > now + LOOKAHEAD_MS) continue;
    if (best && startMs >= best.startMs) continue;

    best = {
      eventId: event.id ?? name.replace(/\.json$/, ""),
      summary: event.summary?.trim() || "Untitled meeting",
      startMs,
      endMs,
      conferenceLink: extractConferenceLink(event),
      event,
    };
  }
  return best;
}

let timer: NodeJS.Timeout | null = null;

export function initNextMeetingTray(): void {
  if (timer || !hasTray()) return;
  const tick = async () => {
    try {
      setTrayNextMeeting(await scanNextMeeting());
    } catch (err) {
      console.error("[Tray] next-meeting scan failed:", err);
    }
  };
  void tick();
  timer = setInterval(() => {
    void tick();
  }, POLL_MS);
}
