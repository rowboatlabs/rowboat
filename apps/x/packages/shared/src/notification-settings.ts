import { z } from 'zod';

/**
 * Notification categories the user can independently toggle.
 *
 * - chat_completion:  an agent finished generating a response
 * - new_email:        a new email arrived during incremental Gmail sync
 * - agent_permission: an agent is requesting permission to run a tool
 * - background_task:  a background task agent pinged via the notify-user tool
 */
export const NotificationCategorySchema = z.enum([
  'chat_completion',
  'new_email',
  'agent_permission',
  'background_task',
]);

export const NotificationCategoriesSchema = z.object({
  chat_completion: z.boolean(),
  new_email: z.boolean(),
  agent_permission: z.boolean(),
  background_task: z.boolean(),
});

export const NotificationSettingsSchema = z.object({
  categories: NotificationCategoriesSchema,
});

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  categories: {
    chat_completion: true,
    new_email: true,
    agent_permission: true,
    background_task: true,
  },
};

export type NotificationCategory = z.infer<typeof NotificationCategorySchema>;
export type NotificationCategories = z.infer<typeof NotificationCategoriesSchema>;
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
