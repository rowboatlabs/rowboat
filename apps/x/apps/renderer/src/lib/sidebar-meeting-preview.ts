export function compareMeetingStarts(a: { start: Date }, b: { start: Date }): number {
  return a.start.getTime() - b.start.getTime()
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function formatMeetingTime(event: { start: Date; isAllDay: boolean }): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (event.isAllDay) {
    if (isSameLocalDay(event.start, now)) return 'All day'
    if (isSameLocalDay(event.start, tomorrow)) return 'Tmrw · All day'
    const date = event.start.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
    return `${date} · All day`
  }
  const time = event.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (isSameLocalDay(event.start, now)) return time
  if (isSameLocalDay(event.start, tomorrow)) return `Tmrw ${time}`
  return event.start.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}
