import type { BackgroundTaskSummary, Triggers } from '@x/shared/dist/background-task.js'

// A scheduled task's timing in plain words (Baarali, 02/10/2026): « Every day
// at 07:00 GMT » instead of « 0 7 * * * ». The scheduler reads cron and time
// windows on the instance's clock, which runs on UTC: GMT, West Africa's time.
// English here like the rest of the interface; the French is in the
// dictionary.

const two = (n: number) => String(n).padStart(2, '0')
const isNum = (s: string) => /^\d+$/.test(s)

/** One cron expression in words, or null when it is not a common shape. */
export function cronWords(expr: string): string | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [min, hour, dom, mon, dow] = f
  if (dom !== '*' || mon !== '*') return null
  if (min === '*' && hour === '*' && dow === '*') return 'Every minute'
  const everyMin = /^\*\/(\d+)$/.exec(min)
  if (everyMin && hour === '*' && dow === '*') return `Every ${everyMin[1]} minutes`
  if (min === '0' && hour === '*' && dow === '*') return 'Every hour'
  const everyHour = /^\*\/(\d+)$/.exec(hour)
  if (min === '0' && everyHour && dow === '*') return `Every ${everyHour[1]} hours`
  if (!isNum(min) || !isNum(hour)) return null
  const at = `${two(Number(hour))}:${two(Number(min))}`
  if (dow === '*') return `Every day at ${at} GMT`
  if (dow === '1-5') return `Weekdays at ${at} GMT`
  if (isNum(dow) && Number(dow) <= 7) return weekly(Number(dow) % 7, at)
  return null
}

/** One whole sentence per day: the dictionary translates sentences, not
 * a day's name dropped into one. */
function weekly(day: number, at: string): string {
  switch (day) {
    case 1: return `Every Monday at ${at} GMT`
    case 2: return `Every Tuesday at ${at} GMT`
    case 3: return `Every Wednesday at ${at} GMT`
    case 4: return `Every Thursday at ${at} GMT`
    case 5: return `Every Friday at ${at} GMT`
    case 6: return `Every Saturday at ${at} GMT`
    default: return `Every Sunday at ${at} GMT`
  }
}

/** All of a task's triggers, one phrase each. */
export function scheduleWords(triggers: Triggers | undefined): string[] {
  const out: string[] = []
  if (triggers?.cronExpr) out.push(cronWords(triggers.cronExpr) ?? triggers.cronExpr)
  const windows = triggers?.windows ?? []
  if (windows.length === 1) out.push(`Every day between ${windows[0].startTime} and ${windows[0].endTime} GMT`)
  else if (windows.length > 1) out.push(`${windows.length} times a day`)
  if (triggers?.eventMatchCriteria) out.push('When something it watches for happens')
  if (out.length === 0) out.push('Only when you run it')
  return out
}

/** The morning planner ships seeded, with a long doctrine for instructions:
 * its card says what it does instead of quoting the doctrine. */
export const isPlanner = (t: Pick<BackgroundTaskSummary, 'slug' | 'name'>): boolean =>
  /planner|planificateur/i.test(t.slug) || /planner|planificateur/i.test(t.name)
