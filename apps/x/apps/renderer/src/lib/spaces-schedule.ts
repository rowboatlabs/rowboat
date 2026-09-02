// Renderer-side helpers for scheduled sends and /remind — parsing and
// presets only; the queue itself lives in main (core scheduler).

export interface SchedulePreset {
    label: string
    at: Date
}

function atHour(base: Date, dayOffset: number, hour: number): Date {
    const d = new Date(base)
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hour, 0, 0, 0)
    return d
}

/** The send-later menu: a Slack-shaped spread of near-term moments. */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
    const presets: SchedulePreset[] = [
        { label: 'In 30 minutes', at: new Date(now.getTime() + 30 * 60_000) },
        { label: 'In 1 hour', at: new Date(now.getTime() + 60 * 60_000) },
        { label: 'In 3 hours', at: new Date(now.getTime() + 3 * 60 * 60_000) },
        { label: 'Tomorrow 9:00', at: atHour(now, 1, 9) },
    ]
    // Next Monday 9:00 (today-is-Monday means the one a week out).
    const daysToMonday = ((8 - now.getDay()) % 7) || 7
    presets.push({ label: 'Monday 9:00', at: atHour(now, daysToMonday, 9) })
    return presets
}

export function formatScheduleTime(at: Date, now: Date = new Date()): string {
    const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    if (at.toDateString() === now.toDateString()) return time
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    if (at.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
    return `${at.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`
}

/**
 * "/remind <when> <text>" → when + text, or a usage-error string. Accepted
 * whens: `20m` `2h` `1d`, `9:30` (next occurrence), `tomorrow`,
 * `tomorrow 9:30`.
 */
export function parseRemindArgs(args: string, now: Date = new Date()): { at: Date; text: string } | string {
    const usage = 'Usage: /remind <20m | 2h | 9:30 | tomorrow [9:30]> <text>'
    const tokens = args.split(/\s+/).filter(Boolean)
    const first = tokens[0]?.toLowerCase()
    if (!first) return usage

    const offset = /^(\d+)(m|min|h|hr|d)$/.exec(first)
    const clock = /^(\d{1,2}):(\d{2})$/.exec(first)
    let at: Date | null = null
    let used = 1

    if (offset) {
        const n = Number(offset[1])
        const unit = offset[2]!.startsWith('m') ? 60_000 : offset[2]!.startsWith('h') ? 3_600_000 : 86_400_000
        at = new Date(now.getTime() + n * unit)
    } else if (clock) {
        const h = Number(clock[1])
        const min = Number(clock[2])
        if (h > 23 || min > 59) return usage
        at = new Date(now)
        at.setHours(h, min, 0, 0)
        if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
    } else if (first === 'tomorrow') {
        const second = /^(\d{1,2}):(\d{2})$/.exec(tokens[1] ?? '')
        at = new Date(now)
        at.setDate(at.getDate() + 1)
        if (second) {
            at.setHours(Number(second[1]), Number(second[2]), 0, 0)
            used = 2
        } else {
            at.setHours(9, 0, 0, 0)
        }
    }

    if (!at) return usage
    const text = tokens.slice(used).join(' ')
    if (!text) return usage
    return { at, text }
}
