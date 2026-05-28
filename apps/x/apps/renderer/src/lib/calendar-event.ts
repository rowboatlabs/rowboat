/**
 * Matches a video-conference join URL for the providers we support (Zoom,
 * Microsoft Teams, Google Meet). Captures the full URL up to the first
 * whitespace, quote, or angle/round/square bracket.
 */
const MEETING_URL_RE =
  /https?:\/\/(?:[a-z0-9-]+\.)*(?:zoom\.us|zoomgov\.com|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com)\/[^\s"'<>)\]]+/i

function findMeetingUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const match = MEETING_URL_RE.exec(value)
  // Calendar descriptions are often HTML, so decode &amp; back to & in the URL.
  return match ? match[0].replace(/&amp;/g, '&') : undefined
}

/**
 * Extract a video conference link from raw Google Calendar event JSON.
 * Checks conferenceData.entryPoints (video type), hangoutLink, a top-level
 * conferenceLink, then falls back to scanning the location/description for a
 * known meeting URL (Zoom, Microsoft Teams, Google Meet).
 */
export function extractConferenceLink(raw: Record<string, unknown>): string | undefined {
  const confData = raw.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined
  if (confData?.entryPoints) {
    const video = confData.entryPoints.find(ep => ep.entryPointType === 'video')
    if (video?.uri) return video.uri
  }
  if (typeof raw.hangoutLink === 'string') return raw.hangoutLink
  if (typeof raw.conferenceLink === 'string') return raw.conferenceLink
  return findMeetingUrl(raw.location) ?? findMeetingUrl(raw.description)
}
