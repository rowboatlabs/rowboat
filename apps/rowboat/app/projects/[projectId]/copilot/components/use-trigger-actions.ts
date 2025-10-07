'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { CopilotAssistantMessageActionPart, TriggerSchemaForCopilot } from "@/src/entities/models/copilot";
import { Message } from "@/app/lib/types/types";

type ScheduledJobActionsModule = typeof import('@/app/actions/scheduled-job-rules.actions');
type RecurringJobActionsModule = typeof import('@/app/actions/recurring-job-rules.actions');
type ComposioActionsModule = typeof import('@/app/actions/composio.actions');

type CopilotTrigger = z.infer<typeof TriggerSchemaForCopilot>;
type CopilotAction = z.infer<typeof CopilotAssistantMessageActionPart>['content'];

export interface TriggerSetupModalState {
    action: CopilotAction;
    actionIndex: number;
    messageIndex: number;
    initialToolkitSlug: string | null;
    initialTriggerTypeSlug: string | null;
    initialConfig?: Record<string, unknown>;
}

interface UseCopilotTriggerActionsParams {
    projectId: string;
    triggers?: CopilotTrigger[];
    onTriggersUpdated?: () => Promise<void> | void;
    hasUpcomingReplacement: (action: CopilotAction, currentIndex?: number) => boolean;
}

interface UseCopilotTriggerActionsResult {
    triggerSetupModal: TriggerSetupModalState | null;
    requestTriggerSetup: (params: { action: CopilotAction; actionIndex: number; messageIndex: number }) => void;
    closeTriggerSetup: () => void;
    handleTriggerCreatedViaModal: () => Promise<void>;
    handleTriggerAction: (action: CopilotAction, context?: { actionIndex?: number; messageIndex?: number }) => Promise<boolean>;
}

let scheduledJobActionsPromise: Promise<ScheduledJobActionsModule> | null = null;
let recurringJobActionsPromise: Promise<RecurringJobActionsModule> | null = null;
let composioActionsPromise: Promise<ComposioActionsModule> | null = null;

function loadScheduledJobActions(): Promise<ScheduledJobActionsModule> {
    if (!scheduledJobActionsPromise) {
        scheduledJobActionsPromise = import('@/app/actions/scheduled-job-rules.actions');
    }
    return scheduledJobActionsPromise;
}

function loadRecurringJobActions(): Promise<RecurringJobActionsModule> {
    if (!recurringJobActionsPromise) {
        recurringJobActionsPromise = import('@/app/actions/recurring-job-rules.actions');
    }
    return recurringJobActionsPromise;
}

function loadComposioActions(): Promise<ComposioActionsModule> {
    if (!composioActionsPromise) {
        composioActionsPromise = import('@/app/actions/composio.actions');
    }
    return composioActionsPromise;
}

const hasOwn = (obj: Record<string, unknown> | undefined, key: string) =>
    !!obj && Object.prototype.hasOwnProperty.call(obj, key);

const buildTriggerKey = (configType: string, name: string) => `${configType}:${name}`;

const toStringOrNull = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value;
    }
    return null;
};

const extractSlug = (primary: unknown, secondary: unknown, tertiary: unknown): string | null => {
    return (
        toStringOrNull(primary) ??
        toStringOrNull(secondary) ??
        (typeof tertiary === 'object' && tertiary !== null ? toStringOrNull((tertiary as { slug?: unknown }).slug) : toStringOrNull(tertiary))
    );
};

const TriggerInputSchema = z.object({
    messages: z.array(Message),
});

type TriggerInput = z.infer<typeof TriggerInputSchema>;

const coerceTriggerInput = (value: unknown, fallback?: TriggerInput | null): TriggerInput | null => {
    if (value) {
        const parsed = TriggerInputSchema.safeParse(value);
        if (parsed.success) {
            return parsed.data;
        }
    }
    return fallback ?? null;
};

const extractTriggerSetupState = (
    params: { action: CopilotAction; actionIndex: number; messageIndex: number }
): TriggerSetupModalState => {
    const { action, actionIndex, messageIndex } = params;
    const changes = (action?.config_changes ?? {}) as Record<string, unknown>;

    const initialToolkitSlug = extractSlug(changes.toolkitSlug, changes.toolkit_slug, changes.toolkit);
    const initialTriggerTypeSlug = extractSlug(changes.triggerTypeSlug, changes.trigger_type_slug, changes.triggerType);
    const triggerConfigCandidate = (changes.triggerConfig ?? changes.trigger_config ?? changes.config) as unknown;
    const initialConfig = typeof triggerConfigCandidate === 'object' && triggerConfigCandidate !== null
        ? (triggerConfigCandidate as Record<string, unknown>)
        : undefined;

    return {
        action,
        actionIndex,
        messageIndex,
        initialToolkitSlug,
        initialTriggerTypeSlug,
        initialConfig,
    };
};

export function useCopilotTriggerActions({
    projectId,
    triggers,
    onTriggersUpdated,
    hasUpcomingReplacement,
}: UseCopilotTriggerActionsParams): UseCopilotTriggerActionsResult {
    const [triggerSetupModal, setTriggerSetupModal] = useState<TriggerSetupModalState | null>(null);
    const triggersRef = useRef<CopilotTrigger[]>(triggers ?? []);
    const pendingTriggerEditsRef = useRef<Map<string, CopilotTrigger>>(new Map());

    useEffect(() => {
        triggersRef.current = triggers ?? [];
        pendingTriggerEditsRef.current.clear();
    }, [triggers]);

    const refreshTriggers = useCallback(async () => {
        if (!onTriggersUpdated) {
            return;
        }
        await onTriggersUpdated();
    }, [onTriggersUpdated]);

    const requestTriggerSetup = useCallback((params: { action: CopilotAction; actionIndex: number; messageIndex: number }) => {
        setTriggerSetupModal(prev => {
            if (prev && prev.actionIndex === params.actionIndex && prev.messageIndex === params.messageIndex) {
                return prev;
            }
            return extractTriggerSetupState(params);
        });
    }, []);

    const closeTriggerSetup = useCallback(() => {
        setTriggerSetupModal(null);
    }, []);

    const handleTriggerCreatedViaModal = useCallback(async () => {
        await refreshTriggers();
        closeTriggerSetup();
    }, [refreshTriggers, closeTriggerSetup]);

    const handleOneTimeTrigger = useCallback(async (action: CopilotAction, context?: { actionIndex?: number }) => {
        const triggerList = triggersRef.current;
        const key = buildTriggerKey(action.config_type, action.name);
        const actionChanges = (action.config_changes ?? {}) as Record<string, unknown>;
        let mutated = false;
        const actionIndex = context?.actionIndex;

        if (action.action === 'create_new') {
            const pending = pendingTriggerEditsRef.current.get(key);
            const { createScheduledJobRule, updateScheduledJobRule } = await loadScheduledJobActions();

            if (pending && pending.type === 'one_time') {
                const scheduledTime = (actionChanges.scheduledTime as string) ?? pending.nextRunAt;
                const input = coerceTriggerInput(actionChanges.input, pending.input);
                if (!scheduledTime || !input) {
                    console.error('Missing data for one-time trigger update via replacement', action);
                    return false;
                }

                await updateScheduledJobRule({
                    projectId,
                    ruleId: pending.id,
                    scheduledTime,
                    input,
                });
                pendingTriggerEditsRef.current.delete(key);
                mutated = true;
            } else {
                const scheduledTime = actionChanges.scheduledTime as string | undefined;
                const input = coerceTriggerInput(actionChanges.input);
                if (!scheduledTime || !input) {
                    console.error('Missing scheduledTime or input for one-time trigger creation', action);
                    return false;
                }

                await createScheduledJobRule({
                    projectId,
                    scheduledTime,
                    input,
                });
                mutated = true;
            }
            return mutated;
        }

        const target = triggerList.find(
            (trigger): trigger is Extract<CopilotTrigger, { type: 'one_time' }> =>
                trigger.type === 'one_time' && trigger.name === action.name
        );

        if (!target) {
            console.warn('Unable to resolve one-time trigger for action', action.name);
            return false;
        }

        const {
            fetchScheduledJobRule,
            deleteScheduledJobRule,
            updateScheduledJobRule,
        } = await loadScheduledJobActions();

        if (action.action === 'delete') {
            if (hasUpcomingReplacement(action, actionIndex)) {
                pendingTriggerEditsRef.current.set(key, target);
                return true;
            }

            pendingTriggerEditsRef.current.delete(key);
            await deleteScheduledJobRule({ projectId, ruleId: target.id });
            mutated = true;
            return mutated;
        }

        if (action.action === 'edit') {
            const existing = await fetchScheduledJobRule({ ruleId: target.id });
            if (!existing) {
                console.error('Failed to load existing one-time trigger for edit', action.name);
                return false;
            }

            const scheduledTime = (actionChanges.scheduledTime as string) ?? existing.nextRunAt;
            const input = coerceTriggerInput(actionChanges.input, existing.input);

            if (!scheduledTime || !input) {
                console.error('Missing data for one-time trigger edit', action);
                return false;
            }

            await updateScheduledJobRule({
                projectId,
                ruleId: target.id,
                scheduledTime,
                input,
            });
            mutated = true;
        }

        return mutated;
    }, [projectId, hasUpcomingReplacement]);

    const handleRecurringTrigger = useCallback(async (action: CopilotAction, context?: { actionIndex?: number }) => {
        const triggerList = triggersRef.current;
        const key = buildTriggerKey(action.config_type, action.name);
        const actionChanges = (action.config_changes ?? {}) as Record<string, unknown>;
        let mutated = false;
        const actionIndex = context?.actionIndex;

        const {
            createRecurringJobRule,
            updateRecurringJobRule,
            toggleRecurringJobRule,
            deleteRecurringJobRule,
            fetchRecurringJobRule,
        } = await loadRecurringJobActions();

        if (action.action === 'create_new') {
            const pending = pendingTriggerEditsRef.current.get(key);

            if (pending && pending.type === 'recurring') {
                const cron = (actionChanges.cron as string) ?? pending.cron;
                const input = coerceTriggerInput(actionChanges.input, pending.input);
                if (!cron || !input) {
                    console.error('Missing data for recurring trigger update via replacement', action);
                    return false;
                }

                const updatedRule = await updateRecurringJobRule({
                    projectId,
                    ruleId: pending.id,
                    cron,
                    input,
                });

                if (hasOwn(actionChanges, 'disabled')) {
                    const desired = typeof actionChanges.disabled === 'boolean'
                        ? actionChanges.disabled
                        : pending.disabled;
                    if (typeof desired === 'boolean' && desired !== pending.disabled) {
                        await toggleRecurringJobRule({ ruleId: pending.id, disabled: desired });
                    }
                }

                pendingTriggerEditsRef.current.delete(key);
                mutated = Boolean(updatedRule?.id);
            } else {
                const cron = actionChanges.cron as string | undefined;
                const input = coerceTriggerInput(actionChanges.input);
                if (!cron || !input) {
                    console.error('Missing cron or input for recurring trigger creation', action);
                    return false;
                }

                await createRecurringJobRule({
                    projectId,
                    cron,
                    input,
                });
                mutated = true;
            }

            return mutated;
        }

        const target = triggerList.find(
            (trigger): trigger is Extract<CopilotTrigger, { type: 'recurring' }> =>
                trigger.type === 'recurring' && trigger.name === action.name
        );

        if (!target) {
            console.warn('Unable to resolve recurring trigger for action', action.name);
            return false;
        }

        if (action.action === 'delete') {
            if (hasUpcomingReplacement(action, actionIndex)) {
                pendingTriggerEditsRef.current.set(key, target);
                return true;
            }

            pendingTriggerEditsRef.current.delete(key);
            await deleteRecurringJobRule({ projectId, ruleId: target.id });
            mutated = true;
            return mutated;
        }

        if (action.action === 'edit') {
            const existing = await fetchRecurringJobRule({ ruleId: target.id });
            if (!existing) {
                console.error('Failed to load existing recurring trigger for edit', action.name);
                return false;
            }

            const desiredDisabled = typeof actionChanges.disabled === 'boolean'
                ? actionChanges.disabled
                : existing.disabled;

            const hasCronChange = hasOwn(actionChanges, 'cron');
            const hasInputChange = hasOwn(actionChanges, 'input');
            const hasDisabledToggle = hasOwn(actionChanges, 'disabled');

            if (!hasCronChange && !hasInputChange && hasDisabledToggle) {
                if (desiredDisabled !== existing.disabled) {
                    await toggleRecurringJobRule({ ruleId: target.id, disabled: desiredDisabled });
                }
                return true;
            }

            const cron = (actionChanges.cron as string) ?? existing.cron;
            const input = coerceTriggerInput(actionChanges.input, existing.input);

            if (!cron || !input) {
                console.error('Missing data for recurring trigger edit', action);
                return false;
            }

            const updatedRule = await updateRecurringJobRule({
                projectId,
                ruleId: target.id,
                cron,
                input,
            });

            if (hasDisabledToggle && desiredDisabled !== updatedRule.disabled) {
                await toggleRecurringJobRule({ ruleId: target.id, disabled: desiredDisabled });
            }
            mutated = true;
        }

        return mutated;
    }, [projectId, hasUpcomingReplacement]);

    const handleExternalTrigger = useCallback(async (action: CopilotAction, context?: { actionIndex?: number; messageIndex?: number }) => {
        if (action.action === 'create_new') {
            const actionIndex = context?.actionIndex ?? -1;
            const messageIndex = context?.messageIndex ?? -1;
            requestTriggerSetup({ action, actionIndex, messageIndex });
            return false;
        }

        if (action.action === 'delete') {
            const triggerList = triggersRef.current;
            const target = triggerList.find((trigger): trigger is Extract<CopilotTrigger, { type: 'external' }> => {
                if (trigger.type !== 'external') {
                    return false;
                }
                const maybeName = (trigger as unknown as { name?: string }).name;
                return (
                    trigger.triggerTypeName === action.name ||
                    trigger.triggerTypeSlug === action.name ||
                    trigger.id === action.name ||
                    maybeName === action.name
                );
            });

            if (!target) {
                console.warn('Unable to resolve external trigger for action', action.name);
                return false;
            }

            const { deleteComposioTriggerDeployment } = await loadComposioActions();
            await deleteComposioTriggerDeployment({ projectId, deploymentId: target.id });
            return true;
        }

        return false;
    }, [projectId, requestTriggerSetup]);

    const handleTriggerAction = useCallback(async (action: CopilotAction, context?: { actionIndex?: number; messageIndex?: number }) => {
        if (action.config_type === 'one_time_trigger') {
            const mutated = await handleOneTimeTrigger(action, context);
            if (mutated) {
                await refreshTriggers();
            }
            return mutated;
        }

        if (action.config_type === 'recurring_trigger') {
            const mutated = await handleRecurringTrigger(action, context);
            if (mutated) {
                await refreshTriggers();
            }
            return mutated;
        }

        if (action.config_type === 'external_trigger') {
            const mutated = await handleExternalTrigger(action, context);
            if (mutated) {
                await refreshTriggers();
            }
            return mutated;
        }

        return false;
    }, [handleOneTimeTrigger, handleRecurringTrigger, handleExternalTrigger, refreshTriggers]);

    return {
        triggerSetupModal,
        requestTriggerSetup,
        closeTriggerSetup,
        handleTriggerCreatedViaModal: handleTriggerCreatedViaModal,
        handleTriggerAction,
    };
}
