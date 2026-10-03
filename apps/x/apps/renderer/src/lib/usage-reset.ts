// When the usage windows start over (Baarali, 02/10/2026). Baarali's quota
// is a 5-hour session and a week (control quota.ts), not the upstream's
// day at 00:00 UTC. Times are told in West Africa time (GMT) — the clock of
// the people it is for, whatever the computer is set to.

export const USAGE_TIME_ZONE = 'Africa/Abidjan'

const clock = new Intl.DateTimeFormat('fr-FR', { timeZone: USAGE_TIME_ZONE, hour: '2-digit', minute: '2-digit' })
const day = new Intl.DateTimeFormat('fr-FR', { timeZone: USAGE_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'short' })

/** "3 h 08", "45 min", "1 min". */
export function timeLeft(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** The 5-hour session: open until a time, or not open yet. */
export function sessionResetText(resetsAt: string | undefined, now: number = Date.now()): string {
  const end = resetsAt ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(end) || end <= now) return 'Starts with your next message'
  return `Resets at ${clock.format(end)} GMT (in ${timeLeft(end - now)})`
}

/** The week: the day and time it renews. */
export function weekResetText(resetsAt: string | undefined): string | undefined {
  const end = resetsAt ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(end)) return undefined
  return `Renews ${day.format(end)} at ${clock.format(end)} GMT`
}

/** The sidebar's short line: "Resets in 3 h 08", or not open yet. */
export function sessionCountdown(resetsAt: string | undefined, now: number = Date.now()): string {
  const end = resetsAt ? Date.parse(resetsAt) : NaN
  if (!Number.isFinite(end) || end <= now) return 'Starts with your next message'
  return `Resets in ${timeLeft(end - now)}`
}
