/**
 * Extract a video conference link from raw Google Calendar event JSON.
 * Checks conferenceData.entryPoints (video type), hangoutLink, then falls back
 * to a top-level conferenceLink if present.
 */
export function extractConferenceLink(raw: Record<string, unknown>): string | undefined {
  const confData = raw.conferenceData as { entryPoints?: { entryPointType?: string; uri?: string }[] } | undefined
  if (confData?.entryPoints) {
    const video = confData.entryPoints.find(ep => ep.entryPointType === 'video')
    if (video?.uri) return video.uri
  }
  if (typeof raw.hangoutLink === 'string') return raw.hangoutLink
  if (typeof raw.conferenceLink === 'string') return raw.conferenceLink
  return undefined
}
