import { z } from 'zod';
import { DEFAULT_MAX_MODEL_CALLS } from './turns.js';

/**
 * User-configurable model-call budgets (see issue #768).
 *
 * - maxModelCalls: the global limit every turn inherits by default,
 *   including headless/knowledge work and spawned sub-agents (it is also
 *   the cap a parent can grant a sub-agent).
 * - chatMaxModelCalls: optional override for interactive chat turns only;
 *   when absent, chat uses the global limit.
 *
 * Changing these affects only newly created turns — each turn persists its
 * resolved limit in turn_created.config.maxModelCalls.
 */
export const MIN_MODEL_CALL_LIMIT = 1;
export const MAX_MODEL_CALL_LIMIT = 500;

const limit = z
  .number()
  .int()
  .min(MIN_MODEL_CALL_LIMIT)
  .max(MAX_MODEL_CALL_LIMIT);

export const TurnLimitsSettingsSchema = z.object({
  maxModelCalls: limit,
  chatMaxModelCalls: limit.optional(),
});

export const DEFAULT_TURN_LIMITS_SETTINGS: TurnLimitsSettings = {
  maxModelCalls: DEFAULT_MAX_MODEL_CALLS,
};

export type TurnLimitsSettings = z.infer<typeof TurnLimitsSettingsSchema>;
