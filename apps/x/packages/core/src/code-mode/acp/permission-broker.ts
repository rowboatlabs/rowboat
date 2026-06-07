import type {
    RequestPermissionRequest,
    RequestPermissionResponse,
    PermissionOption,
    PermissionOptionKind,
} from '@agentclientprotocol/sdk';
import type { ApprovalPolicy, PermissionDecision, PermissionAsk } from './types.js';

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
    };
}

// Map a desired decision to one of the options the agent actually offered.
// Agents may offer only a subset (e.g. allow_once + reject_once, no allow_always),
// so we fall back within the same allow/reject family before giving up.
function pickOption(options: PermissionOption[], decision: PermissionDecision): PermissionOption | undefined {
    const order: Record<PermissionDecision, PermissionOptionKind[]> = {
        allow_always: ['allow_always', 'allow_once'],
        allow_once: ['allow_once', 'allow_always'],
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

// A request's identity for "always allow" memory: prefer tool kind, else title.
function memoryKey(ask: PermissionAsk): string {
    return ask.kind ? `kind:${ask.kind}` : `title:${ask.title}`;
}

export interface PermissionBrokerOptions {
    policy: ApprovalPolicy;
    // Called only when the policy can't decide on its own (the "ask" path).
    ask: (ask: PermissionAsk) => Promise<PermissionDecision>;
    // Notified of every resolved request so the engine can emit a stream event.
    onResolved?: (ask: PermissionAsk, decision: PermissionDecision, auto: boolean) => void;
}

// Decides how to answer the agent's requestPermission calls. Holds per-session
// "always allow" memory so a one-time approval sticks for the rest of the run.
export class PermissionBroker {
    private readonly opts: PermissionBrokerOptions;
    private readonly alwaysAllow = new Set<string>();

    constructor(opts: PermissionBrokerOptions) {
        this.opts = opts;
    }

    async resolve(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
        const ask = toAsk(request);
        const key = memoryKey(ask);

        const finish = (decision: PermissionDecision, auto: boolean): RequestPermissionResponse => {
            if (decision === 'allow_always') this.alwaysAllow.add(key);
            this.opts.onResolved?.(ask, decision, auto);
            const opt = pickOption(request.options, decision);
            // If the agent offered no matching option we fall back to its first one
            // (don't deadlock the turn); decision precedence above keeps this rare.
            return selected(opt?.optionId ?? request.options[0]?.optionId ?? '');
        };

        // 1. Sticky "always allow" from earlier this session.
        if (this.alwaysAllow.has(key)) return finish('allow_always', true);

        // 2. Policy-level auto decisions.
        if (this.opts.policy === 'yolo') return finish('allow_always', true);
        if (this.opts.policy === 'auto-approve-reads' && ask.isRead) return finish('allow_once', true);

        // 3. Ask the user.
        const decision = await this.opts.ask(ask);
        return finish(decision, false);
    }
}
