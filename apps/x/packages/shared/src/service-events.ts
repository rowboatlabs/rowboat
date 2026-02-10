import z from 'zod';

export const ServiceName = z.enum([
  'graph',
  'gmail',
  'calendar',
  'fireflies',
  'granola',
  'voice_memo',
]);

const ServiceEventBase = z.object({
  service: ServiceName,
  runId: z.string(),
  ts: z.iso.datetime(),
  level: z.enum(['info', 'warn', 'error']),
  message: z.string(),
});

export const ServiceRunStartEvent = ServiceEventBase.extend({
  type: z.literal('run_start'),
  trigger: z.enum(['timer', 'manual', 'startup']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const ServiceChangesIdentifiedEvent = ServiceEventBase.extend({
  type: z.literal('changes_identified'),
  counts: z.record(z.string(), z.number()).optional(),
  items: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
});

export const ServiceProgressEvent = ServiceEventBase.extend({
  type: z.literal('progress'),
  step: z.string().optional(),
  current: z.number().optional(),
  total: z.number().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ServiceRunCompleteEvent = ServiceEventBase.extend({
  type: z.literal('run_complete'),
  durationMs: z.number(),
  outcome: z.enum(['ok', 'idle', 'skipped', 'error']),
  summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  items: z.array(z.string()).optional(),
  truncated: z.boolean().optional(),
});

export const ServiceErrorEvent = ServiceEventBase.extend({
  type: z.literal('error'),
  error: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export const ServiceEvent = z.union([
  ServiceRunStartEvent,
  ServiceChangesIdentifiedEvent,
  ServiceProgressEvent,
  ServiceRunCompleteEvent,
  ServiceErrorEvent,
]);

export type ServiceNameType = z.infer<typeof ServiceName>;
export type ServiceEventType = z.infer<typeof ServiceEvent>;
