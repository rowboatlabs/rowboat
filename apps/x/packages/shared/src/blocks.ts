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
