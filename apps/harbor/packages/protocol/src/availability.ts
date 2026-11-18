import { z } from 'zod';

export const NotificationSchedule = z.object({
  timeZone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Choose a valid time zone'),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export const Availability = z.object({
  manualAway: z.boolean().optional(),
  status: z.object({ text: z.string().max(100), emoji: z.string().max(32), pauseNotifications: z.boolean().optional(), expiresAt: z.iso.datetime().nullable() }).nullable().optional(),
  pausedUntil: z.iso.datetime().nullable().optional(),
  resumedUntil: z.iso.datetime().nullable().optional(),
  schedule: NotificationSchedule.nullable().optional(),
});
export type Availability = z.infer<typeof Availability>;

export function currentStatus(value: Availability | undefined, now = Date.now()) {
  const status = value?.status;
  return status && (!status.expiresAt || Date.parse(status.expiresAt) > now) ? status : undefined;
}

export function notificationsPaused(value: Availability | undefined, now = Date.now()): boolean {
  if (value?.pausedUntil && Date.parse(value.pausedUntil) > now) return true;
  if (value?.resumedUntil && Date.parse(value.resumedUntil) > now) return false;
  if (currentStatus(value, now)?.pauseNotifications) return true;
  const schedule = value?.schedule;
  if (!schedule) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const time = `${part('hour')}:${part('minute')}`;
  const { start, end, days } = schedule;
  const allowed = start === end ? days.includes(day)
    : start < end ? days.includes(day) && time >= start && time < end
    : (days.includes(day) && time >= start) || (days.includes((day + 6) % 7) && time < end);
  return !allowed;
}
