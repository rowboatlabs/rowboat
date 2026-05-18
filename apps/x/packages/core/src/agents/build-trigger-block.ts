import type { Triggers } from '@x/shared/dist/live-note.js';

export type TriggerType = 'manual' | 'cron' | 'window' | 'event';

export interface BuildTriggerBlockOptions {
    trigger: TriggerType;
    triggers?: Triggers;

    /** For 'manual' / 'cron' / 'window' branches — extra context for THIS run. */
    context?: string;

    /** For 'event' branch — the matched event's payload. */
    eventPayload?: string;

    /**
     * Noun for the target entity in the event-branch wording — "flagged this
     * {targetNoun}", "Event match criteria for this {targetNoun}:". Live-note
     * passes 'note'; bg-task passes 'task'. Default 'target'.
     */
    targetNoun?: string;

    /**
     * Noun for the user's persistent intent — "if your {instructionsNoun}
     * specifies different behavior…" in the cron/window branches. Live-note
     * passes 'objective'; bg-task uses the default 'instructions'.
     */
    instructionsNoun?: string;

    /**
     * Text shown inside the manual-trigger parenthetical, after "Manual run".
     * Live-note passes:
     *   "user-triggered — either the Run button in the Live Note panel or the
     *   `run-live-note-agent` tool"
     * Bg-task passes:
     *   "user-triggered — either the Run button in the Background Task detail
     *   view or the `run-background-task-agent` tool"
     */
    manualParen?: string;

    /**
     * The "**Decision:** …" paragraph appended to the event branch. Live-note
     * and bg-task pass their own copies so the directive matches their
     * domain (edit the file vs. act on the event).
     */
    eventDecisionDirective?: string;
}

function describeWindow(triggers: Triggers | undefined): string {
    const ws = triggers?.windows;
    if (!ws || ws.length === 0) return 'a configured window';
    return ws.map(w => `${w.startTime}–${w.endTime}`).join(', ');
}

/**
 * Build the "**Trigger:** …" paragraph appended to a scheduled/event/manual
 * agent message. Shared between the live-note runner and the bg-task runner —
 * each passes domain-specific nouns and the event-branch decision directive.
 */
export function buildTriggerBlock(opts: BuildTriggerBlockOptions): string {
    const {
        trigger,
        triggers,
        context,
        eventPayload,
        targetNoun = 'target',
        instructionsNoun = 'instructions',
        manualParen = 'user-triggered',
        eventDecisionDirective,
    } = opts;

    if (trigger === 'event') {
        const criteria = triggers?.eventMatchCriteria ?? '(none — should not happen for event-triggered runs)';
        const decision = eventDecisionDirective ?? '';
        return `

**Trigger:** Event match — Pass 1 routing flagged this ${targetNoun} as potentially relevant to the event below.

**Event match criteria for this ${targetNoun}:**
${criteria}

**Event payload:**
${eventPayload ?? '(no payload)'}

${decision}`;
    }

    if (trigger === 'cron') {
        const expr = triggers?.cronExpr ?? '(unknown)';
        return `

**Trigger:** Scheduled refresh — the cron expression \`${expr}\` matched. This is a baseline refresh; if your ${instructionsNoun} specifies different behavior for cron vs window vs event runs, follow the cron branch.${context ? `\n\n**Context:**\n${context}` : ''}`;
    }

    if (trigger === 'window') {
        return `

**Trigger:** Scheduled refresh — fired inside the configured window (${describeWindow(triggers)}). This is a forgiving baseline refresh that runs once per day per window; reactive updates are handled by event triggers (when configured). If your ${instructionsNoun} specifies different behavior for cron vs window vs event runs, follow the window branch.${context ? `\n\n**Context:**\n${context}` : ''}`;
    }

    // manual
    return `

**Trigger:** Manual run (${manualParen}).${context ? `\n\n**Context:**\n${context}` : ''}`;
}
