import { z } from 'zod';

export const BrowserTabStateSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  loading: z.boolean(),
});

export const BrowserStateSchema = z.object({
  activeTabId: z.string().nullable(),
  tabs: z.array(BrowserTabStateSchema),
});

export const BrowserPageElementSchema = z.object({
  index: z.number().int().positive(),
  tagName: z.string(),
  role: z.string().nullable(),
  type: z.string().nullable(),
  label: z.string().nullable(),
  text: z.string().nullable(),
  placeholder: z.string().nullable(),
  href: z.string().nullable(),
  disabled: z.boolean(),
});

export const BrowserPageSnapshotSchema = z.object({
  snapshotId: z.string(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  text: z.string(),
  elements: z.array(BrowserPageElementSchema),
});

export const BrowserControlActionSchema = z.enum([
  'open',
  'get-state',
  'new-tab',
  'switch-tab',
  'close-tab',
  'navigate',
  'back',
  'forward',
  'reload',
  'read-page',
  'click',
  'type',
  'press',
  'scroll',
  'wait',
]);

const BrowserElementTargetFields = {
  index: z.number().int().positive().optional(),
  selector: z.string().min(1).optional(),
  snapshotId: z.string().optional(),
} as const;

export const BrowserControlInputSchema = z.object({
  action: BrowserControlActionSchema,
  target: z.string().min(1).optional(),
  tabId: z.string().min(1).optional(),
  text: z.string().optional(),
  key: z.string().min(1).optional(),
  direction: z.enum(['up', 'down']).optional(),
  amount: z.number().int().positive().max(5000).optional(),
  ms: z.number().int().positive().max(30000).optional(),
  maxElements: z.number().int().positive().max(100).optional(),
  maxTextLength: z.number().int().positive().max(20000).optional(),
  ...BrowserElementTargetFields,
}).strict().superRefine((value, ctx) => {
  const needsElementTarget = value.action === 'click' || value.action === 'type';
  const hasElementTarget = value.index !== undefined || value.selector !== undefined;

  if ((value.action === 'switch-tab' || value.action === 'close-tab') && !value.tabId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tabId'],
      message: 'tabId is required for this action.',
    });
  }

  if ((value.action === 'navigate') && !value.target) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['target'],
      message: 'target is required for navigate.',
    });
  }

  if (value.action === 'type' && value.text === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['text'],
      message: 'text is required for type.',
    });
  }

  if (value.action === 'press' && !value.key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['key'],
      message: 'key is required for press.',
    });
  }

  if (needsElementTarget && !hasElementTarget) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['index'],
      message: 'Provide an element index or selector.',
    });
  }
});

export const SuggestedBrowserSkillSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
});

export const BrowserControlResultSchema = z.object({
  success: z.boolean(),
  action: BrowserControlActionSchema,
  message: z.string().optional(),
  error: z.string().optional(),
  browser: BrowserStateSchema,
  page: BrowserPageSnapshotSchema.optional(),
  suggestedSkills: z.array(SuggestedBrowserSkillSchema).optional(),
});

export type BrowserTabState = z.infer<typeof BrowserTabStateSchema>;
export type BrowserState = z.infer<typeof BrowserStateSchema>;
export type BrowserPageElement = z.infer<typeof BrowserPageElementSchema>;
export type BrowserPageSnapshot = z.infer<typeof BrowserPageSnapshotSchema>;
export type BrowserControlAction = z.infer<typeof BrowserControlActionSchema>;
export type BrowserControlInput = z.infer<typeof BrowserControlInputSchema>;
export type BrowserControlResult = z.infer<typeof BrowserControlResultSchema>;
export type SuggestedBrowserSkill = z.infer<typeof SuggestedBrowserSkillSchema>;
