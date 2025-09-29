import { z } from "zod";
import { TriggerSchemaForCopilot } from "@/src/entities/models/copilot";
import { Message } from "@/app/lib/types/types";

const COPILOT_TRIGGER_LIMIT = 100;

export const DEFAULT_TRIGGER_FETCH_LIMIT = COPILOT_TRIGGER_LIMIT;

export type CopilotTrigger = z.infer<typeof TriggerSchemaForCopilot>;

interface TransformParams {
    scheduled: Array<{
        id: string;
        nextRunAt: string;
        status: 'pending' | 'processing' | 'triggered';
        input?: { messages: Array<z.infer<typeof Message>> };
    }>;
    recurring: Array<{
        id: string;
        cron: string;
        nextRunAt: string | null;
        disabled: boolean;
        input?: { messages: Array<z.infer<typeof Message>> };
    }>;
    composio: Array<{
        id: string;
        triggerTypeName: string;
        toolkitSlug: string;
        triggerTypeSlug: string;
        triggerConfig: Record<string, unknown>;
    }>;
}

export function transformTriggersForCopilot({
    scheduled,
    recurring,
    composio,
}: TransformParams): CopilotTrigger[] {
    const placeholderInput = {
        messages: [
            {
                role: "user" as const,
                content: "Trigger execution",
            },
        ],
    } satisfies { messages: Array<z.infer<typeof Message>> };

    const oneTime = scheduled.map((trigger) => ({
        type: "one_time" as const,
        id: trigger.id,
        name: `One-time trigger (${new Date(trigger.nextRunAt).toLocaleDateString('en-US')})`,
        nextRunAt: trigger.nextRunAt,
        status: trigger.status,
        input: trigger.input ?? placeholderInput,
    }));

    const recurringTriggers = recurring.map((trigger) => ({
        type: "recurring" as const,
        id: trigger.id,
        name: `Recurring trigger (${trigger.cron})`,
        cron: trigger.cron,
        nextRunAt: trigger.nextRunAt ?? '',
        disabled: trigger.disabled,
        input: trigger.input ?? placeholderInput,
    }));

    const external = composio.map((trigger) => ({
        type: "external" as const,
        id: trigger.id,
        name: trigger.triggerTypeName,
        triggerTypeName: trigger.triggerTypeName,
        toolkitSlug: trigger.toolkitSlug,
        triggerTypeSlug: trigger.triggerTypeSlug,
        triggerConfig: trigger.triggerConfig,
    }));

    return [...oneTime, ...recurringTriggers, ...external] as CopilotTrigger[];
}
