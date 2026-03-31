import { z } from 'zod';

export const ImageBlockSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional(),
});

export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const EmbedBlockSchema = z.object({
  provider: z.enum(['youtube', 'figma', 'generic']),
  url: z.string().url(),
  caption: z.string().optional(),
});

export type EmbedBlock = z.infer<typeof EmbedBlockSchema>;

export const ChartBlockSchema = z.object({
  chart: z.enum(['line', 'bar', 'pie']),
  title: z.string().optional(),
  data: z.array(z.record(z.string(), z.unknown())).optional(),
  source: z.string().optional(),
  x: z.string(),
  y: z.string(),
});

export type ChartBlock = z.infer<typeof ChartBlockSchema>;

export const TableBlockSchema = z.object({
  columns: z.array(z.string()),
  data: z.array(z.record(z.string(), z.unknown())),
  title: z.string().optional(),
});

export type TableBlock = z.infer<typeof TableBlockSchema>;

export const CalendarEventSchema = z.object({
  summary: z.string().optional(),
  start: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
  }).optional(),
  end: z.object({
    dateTime: z.string().optional(),
    date: z.string().optional(),
  }).optional(),
  location: z.string().optional(),
  htmlLink: z.string().optional(),
  conferenceLink: z.string().optional(),
  source: z.string().optional(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarBlockSchema = z.object({
  title: z.string().optional(),
  events: z.array(CalendarEventSchema),
  showJoinButton: z.boolean().optional(),
});

export type CalendarBlock = z.infer<typeof CalendarBlockSchema>;

export const EmailBlockSchema = z.object({
  threadId: z.string().optional(),
  summary: z.string().optional(),
  subject: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  date: z.string().optional(),
  latest_email: z.string(),
  past_summary: z.string().optional(),
  draft_response: z.string().optional(),
  response_mode: z.enum(['inline', 'assistant', 'both']).optional(),
});

export type EmailBlock = z.infer<typeof EmailBlockSchema>;

export const TranscriptBlockSchema = z.object({
  transcript: z.string(),
});

export type TranscriptBlock = z.infer<typeof TranscriptBlockSchema>;
