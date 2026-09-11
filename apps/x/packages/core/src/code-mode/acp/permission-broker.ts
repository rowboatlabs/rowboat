import type {
    RequestPermissionRequest,
    RequestPermissionResponse,
    PermissionOption,
    PermissionOptionKind,
} from '@agentclientprotocol/sdk';
import type { ApprovalPolicy, PermissionDecision, PermissionAsk } from './types.js';
import { toolDetail } from './tool-detail.js';

// Tool kinds that don't mutate anything — eligible for `auto-approve-reads`.
const READ_KINDS = new Set(['read', 'search', 'fetch', 'think']);

function toAsk(request: RequestPermissionRequest): PermissionAsk {
    const tc = request.toolCall;
    const kind = tc.kind ?? undefined;
    const title = tc.title ?? kind ?? 'Tool call';
    return {
        toolCallId: tc.toolCallId ?? undefined,
        title,
        kind,
        isRead: kind ? READ_KINDS.has(kind) : false,
        detail: toolDetail(tc.content, tc.rawInput),
    };
}

// Map a desired decision to one of the options the agent actually offered.
// Agents may offer only a subset (e.g. allow_once + reject_once, no allow_always),
// so unmatched decisions cancel safely; allow-once never widens to persistent.
function pickOption(options: PermissionOption[], decision: PermissionDecision): PermissionOption | undefined {
    const order: Record<PermissionDecision, PermissionOptionKind[]> = {
        allow_always: ['allow_always'],
        allow_once: ['allow_once'],
        reject: ['reject_once', 'reject_always'],
    };
    for (const kind of order[decision]) {
        const found = options.find((o) => o.kind === kind);
        if (found) return found;
    }
    return undefined;
}

function selected(optionId: string): RequestPermissionResponse {
    return { outcome: { outcome: 'selected', optionId } };
}


export interface PermissionBrokerOptions {
    policy: ApprovalPolicy;
    signal?: AbortSignal;
    allowPersistent?: boolean;
    // Called only when the policy can't decide on its own (the "ask" path).
    ask: (ask: PermissionAsk) => Promise<PermissionDecision>;
    // Notified of every resolved request so the engine can emit a stream event.
    onResolved?: (ask: PermissionAsk, decision: PermissionDecision, auto: boolean) => void;
}

// Answers requestPermission without broad local approval memory. Persistent
// scope, when supported, belongs to the engine's explicit offered option.
export class PermissionBroker {
    private readonly opts: PermissionBrokerOptions;
    private readonly cancelled = new AbortController();

    cancel(): void { this.cancelled.abort(); }

    constructor(opts: PermissionBrokerOptions) {
        this.opts = opts;
    }

    async resolve(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
        const ask = toAsk(request);
        ask.allowAlways = this.opts.allowPersistent !== false && request.options.some(o => o.kind === 'allow_always');

        const finish = (decision: PermissionDecision, auto: boolean): RequestPermissionResponse => {
            const opt = decision === 'allow_always' && !ask.allowAlways ? undefined : pickOption(request.options, decision);
            this.opts.onResolved?.(ask, opt ? decision : 'reject', auto);
            return opt ? selected(opt.optionId) : { outcome: { outcome: 'cancelled' } };
        };

        if (this.cancelled.signal.aborted || this.opts.signal?.aborted) return finish('reject', true);

        // 2. Policy-level auto decisions.
        if (this.opts.policy === 'yolo') return finish('allow_once', true);
        if (this.opts.policy === 'auto-approve-reads' && ask.isRead) return finish('allow_once', true);

        // 3. Ask the user.
        const signals = [this.cancelled.signal, this.opts.signal].filter((s): s is AbortSignal => !!s);
        let abort: () => void = () => {};
        const cancelled = new Promise<PermissionDecision>(resolve => {
            abort = () => resolve('reject');
            for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
        });
        try {
            const decision = await Promise.race([this.opts.ask(ask), cancelled]);
            return finish(signals.some(s => s.aborted) ? 'reject' : decision, false);
        } catch {
            return finish('reject', false);
        } finally {
            for (const signal of signals) signal.removeEventListener('abort', abort);
        }
    }
}
