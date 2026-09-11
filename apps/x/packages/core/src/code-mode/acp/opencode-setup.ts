import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { OpenCodeAuthPrompt, OpenCodeSelection, type OpenCodeAuthMethod, type OpenCodeProvider, type OpenCodeSetupState, type OpenCodeSetupError } from '@x/shared/dist/opencode-setup.js';
import { openCodeProcesses, type OpenCodeProcess } from './opencode-process.js';
import { OPENCODE_ROOT } from './opencode-environment.js';

type ErrorCode = z.infer<typeof OpenCodeSetupError>['code'];
export class SetupError extends Error {
    constructor(readonly code: ErrorCode, message: string) { super(message); }
}
export function safeSetupError(error: unknown): { code: ErrorCode; message: string } {
    return error instanceof SetupError ? { code: error.code, message: error.message }
        : { code: 'failed', message: 'OpenCode setup failed. Re-open provider setup and try again.' };
}
const providerList = z.object({ all: z.array(z.object({
    id: z.string(), name: z.string(), env: z.array(z.string()).optional(),
    models: z.record(z.string(), z.object({ id: z.string(), name: z.string(), status: z.string().optional() })),
})), connected: z.array(z.string()) });
const methodList = z.record(z.string(), z.array(z.object({ type: z.string(), label: z.string(), prompts: z.array(z.unknown()).optional() })));
const authorizationSchema = z.object({ url: z.string().url(), method: z.enum(['auto', 'code']), instructions: z.string().max(8000) });
const OAUTH_LIFETIME = 10 * 60_000;
export async function storedProviderIds(): Promise<Set<string>> {
    try {
        const entries: unknown = JSON.parse(await fs.readFile(path.join(OPENCODE_ROOT, 'data', 'opencode', 'auth.json'), 'utf8'));
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return new Set();
        // Inspect only the managed credential store. Never return credential values.
        return new Set(Object.entries(entries).filter(([, value]) => value && typeof value === 'object' &&
            (('type' in value && value.type === 'api' && 'key' in value && typeof value.key === 'string' && value.key.length > 0) ||
             ('type' in value && value.type === 'oauth' && 'refresh' in value && typeof value.refresh === 'string' && value.refresh.length > 0))).map(([id]) => id));
    } catch { return new Set(); }
}

export async function readOpenCodeSelection(): Promise<z.infer<typeof OpenCodeSelection> | undefined> {
    try { return OpenCodeSelection.parse(JSON.parse(await fs.readFile(path.join(OPENCODE_ROOT, 'state', 'rowboat-selection.json'), 'utf8'))); }
    catch { return undefined; }
}
// Bounded built-in flows. Enterprise/custom plugins use the managed login terminal.
function oauthSupported(provider: string, label: string, inputs?: Record<string, string>): boolean {
    return (provider === 'openai' && ['ChatGPT Pro/Plus (browser)', 'ChatGPT Pro/Plus (headless)'].includes(label)) ||
        (provider === 'github-copilot' && label === 'Login with GitHub Copilot' && (!inputs || inputs.deploymentType === 'github.com'));
}
export function validateAuthorizationUrl(provider: string, raw: string): string {
    const url = new URL(raw);
    const hosts = provider === 'openai' ? ['auth.openai.com'] : provider === 'github-copilot' ? ['github.com'] : [];
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname))
        throw new SetupError('unsupported', 'This authorization address is unsupported. Use the managed login flow.');
    return url.href;
}

interface Lease {
    id: string; owner: string; controller: AbortController; process?: OpenCodeProcess;
    starting?: Promise<OpenCodeProcess>; busy: boolean; providers: OpenCodeProvider[];
    attempt?: { id: string; providerId: string; method: number; mode: 'auto' | 'code'; expiresAt: number; timer: ReturnType<typeof setTimeout>; expired: boolean; completing: boolean };
}
export class OpenCodeSetupService {
    private lease?: Lease;
    private generation = 0;
    private selection?: z.infer<typeof OpenCodeSelection>;
    private verified?: OpenCodeSetupState['verified'];
    constructor(private readonly launch = (signal: AbortSignal) => openCodeProcesses.start('serve', { signal }), private readonly requestFetch: typeof fetch = fetch,
        private readonly selectionFile = path.join(OPENCODE_ROOT, 'state', 'rowboat-selection.json'),
        private readonly credentialIds = storedProviderIds) {}

    private require(id: string): Lease {
        if (!this.lease || this.lease.id !== id || this.lease.controller.signal.aborted)
            throw new SetupError('cancelled', 'Provider setup was closed or cancelled. Open it again to continue.');
        return this.lease;
    }
    private async process(lease: Lease): Promise<OpenCodeProcess> {
        if (lease.process) return lease.process;
        if (!lease.starting) lease.starting = this.launch(lease.controller.signal).then(handle => {
            if (this.lease !== lease || lease.controller.signal.aborted) { handle.stop(); throw new SetupError('cancelled', 'Provider setup was cancelled.'); }
            lease.process = handle;
            void handle.exited.then(() => { if (lease.process === handle) { lease.process = undefined; this.verified = undefined; } });
            return handle;
        }).finally(() => { lease.starting = undefined; });
        return lease.starting;
    }
    private restart(lease: Lease): void { lease.process?.stop(); lease.process = undefined; }
    private async request(lease: Lease, route: string, method = 'GET', body?: unknown, timeout = 20_000): Promise<unknown> {
        const handle = await this.process(lease);
        this.require(lease.id);
        try {
            const response = await this.requestFetch(handle.url + route, { method,
                headers: { Authorization: handle.authorization, 'Content-Type': 'application/json' },
                body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
                signal: AbortSignal.any([lease.controller.signal, AbortSignal.timeout(timeout)]),
            });
            if (!response.ok) {
                // Never surface raw upstream bodies; they may contain credentials.
                void response.body?.cancel();
                if ([401, 403].includes(response.status)) throw new SetupError('invalid-credentials', 'Credentials were rejected. Reconnect this provider and verify again.');
                if (response.status === 429) throw new SetupError('rate-limit', 'The provider is rate limited or out of quota. Check your account and retry.');
                if (response.status === 404) throw new SetupError('unavailable-model', 'The provider or model is unavailable. Refresh and select another model.');
                throw new SetupError('failed', `OpenCode could not complete this operation (HTTP ${response.status}). Check the provider settings and retry.`);
            }
            return response.status === 204 ? undefined : await response.json();
        } catch (error) {
            if (error instanceof SetupError) throw error;
            if (lease.controller.signal.aborted) throw new SetupError('cancelled', 'Provider setup was cancelled.');
            throw new SetupError('unavailable', 'The request timed out or the connection was lost. Check your network and retry.');
        }
    }
    private async exclusive<T>(id: string, work: (lease: Lease) => Promise<T>): Promise<T> {
        const lease = this.require(id);
        if (lease.busy || lease.attempt) throw new SetupError('busy', 'Finish or cancel the current operation first.');
        lease.busy = true;
        try { return await work(lease); } finally { lease.busy = false; }
    }
    async start(owner: string): Promise<OpenCodeSetupState> {
        if (this.lease && this.lease.owner !== owner) throw new SetupError('busy', 'Provider setup is already open in another window.');
        if (!this.lease) {
            this.lease = { id: randomUUID(), owner, controller: new AbortController(), busy: false, providers: [] };
        }
        const lease = this.lease;
        if (!lease.process && !lease.starting && !lease.busy) {
            try { this.selection = OpenCodeSelection.parse(JSON.parse(await fs.readFile(this.selectionFile, 'utf8'))); } catch { this.selection = undefined; }
        }
        this.require(lease.id);
        return this.refresh(lease.id);
    }
    stop(id?: string): void {
        const lease = this.lease;
        if (!lease || (id && lease.id !== id)) return;
        this.lease = undefined;
        if (lease.attempt) clearTimeout(lease.attempt.timer);
        lease.controller.abort();
        this.restart(lease);
        this.verified = undefined;
    }
    stopOwner(owner: string): void { if (this.lease?.owner === owner) this.stop(); }
    beginLogin(id: string): void {
        const lease = this.require(id);
        if (lease.busy || lease.attempt) throw new SetupError('busy', 'Finish or cancel the current operation first.');
        lease.busy = true; this.restart(lease); this.changed();
    }
    endLogin(id: string): void { if (this.lease?.id === id) { this.lease.busy = false; this.changed(); } }
    private state(lease: Lease): OpenCodeSetupState {
        return { setupId: lease.id, generation: this.generation, providers: lease.providers, selection: this.selection, verified: this.verified };
    }
    private async discover(lease: Lease): Promise<OpenCodeSetupState> {
        const [rawProviders, rawMethods] = await Promise.all([this.request(lease, '/provider'), this.request(lease, '/provider/auth')]);
        const providers = providerList.parse(rawProviders), methods = methodList.parse(rawMethods);
        const credentials = await this.credentialIds();
        this.require(lease.id);
        lease.providers = providers.all.map(provider => {
            const available = methods[provider.id] ?? [(provider.env?.length ?? 0) > 1
                ? { type: 'unsupported', label: 'Managed login (additional configuration required)' }
                : { type: 'api', label: 'API key' }];
            const auth: OpenCodeAuthMethod[] = available.map((method, index) => {
                const prompts = (method.prompts ?? []).map(prompt => OpenCodeAuthPrompt.safeParse(prompt));
                const supported = prompts.every(p => p.success) && ((method.type === 'api' && prompts.length === 0) || (method.type === 'oauth' && oauthSupported(provider.id, method.label)));
                return { index, label: method.label, type: method.type === 'oauth' ? 'oauth' : method.type === 'api' ? 'api' : 'unsupported', supported,
                    prompts: prompts.flatMap(p => p.success ? [p.data] : []) };
            });
            // Upstream `connected` also includes config-only/free providers; it is
            // not proof of saved credentials and may remain true after DELETE auth.
            return { id: provider.id, name: provider.name, connected: credentials.has(provider.id), methods: auth,
                models: Object.values(provider.models).filter(model => model.status !== 'deprecated').map(model => ({ id: `${provider.id}/${model.id}`, name: model.name })) };
        });
        if (this.verified && !lease.providers.some(p => p.id === this.verified!.providerId && p.connected && p.models.some(m => m.id === this.verified!.modelId))) this.verified = undefined;
        return this.state(lease);
    }
    async refresh(id: string): Promise<OpenCodeSetupState> {
        return this.exclusive(id, async lease => { this.changed(); this.restart(lease); return this.discover(lease); });
    }
    private provider(lease: Lease, providerId: string): OpenCodeProvider {
        const provider = lease.providers.find(p => p.id === providerId);
        if (!provider) throw new SetupError('invalid-input', 'Select an available provider.');
        return provider;
    }
    private changed(): void { this.generation++; this.verified = undefined; }
    async saveKey(id: string, providerId: string, method: number, key: string): Promise<OpenCodeSetupState> {
        return this.exclusive(id, async lease => {
            const selected = this.provider(lease, providerId).methods.find(m => m.index === method);
            if (!selected?.supported || selected.type !== 'api') throw new SetupError('unsupported', 'Use the managed login flow for this authentication method.');
            if (!key.trim()) throw new SetupError('invalid-input', 'Enter an API key.');
            this.changed();
            await this.request(lease, `/auth/${encodeURIComponent(providerId)}`, 'PUT', { type: 'api', key: key.trim() });
            this.restart(lease);
            return this.discover(lease);
        });
    }
    async disconnect(id: string, providerId: string): Promise<OpenCodeSetupState> {
        return this.exclusive(id, async lease => {
            this.provider(lease, providerId); this.changed();
            await this.request(lease, `/auth/${encodeURIComponent(providerId)}`, 'DELETE');
            this.restart(lease);
            return this.discover(lease);
        });
    }
    async authorize(id: string, providerId: string, method: number, inputs: Record<string, string>) {
        return this.exclusive(id, async lease => {
            const selected = this.provider(lease, providerId).methods.find(m => m.index === method);
            if (!selected?.supported || selected.type !== 'oauth' || !oauthSupported(providerId, selected.label, inputs))
                throw new SetupError('unsupported', 'Use the managed login flow for this provider or deployment.');
            const filtered: Record<string, string> = {};
            for (const prompt of selected.prompts) {
                if (prompt.when && ((inputs[prompt.when.key] === prompt.when.value) !== (prompt.when.op === 'eq'))) continue;
                const value = inputs[prompt.key];
                if (!value || (prompt.type === 'select' && !prompt.options?.some(o => o.value === value))) throw new SetupError('invalid-input', 'Complete the authentication fields before continuing.');
                filtered[prompt.key] = value;
            }
            this.changed();
            const auth = authorizationSchema.parse(await this.request(lease, `/provider/${encodeURIComponent(providerId)}/oauth/authorize`, 'POST', { method, inputs: filtered }));
            const url = validateAuthorizationUrl(providerId, auth.url);
            const attemptId = randomUUID(), expiresAt = Date.now() + OAUTH_LIFETIME;
            const timer = setTimeout(() => { if (lease.attempt?.id === attemptId) { lease.attempt.expired = true; this.restart(lease); } }, OAUTH_LIFETIME);
            timer.unref?.();
            lease.attempt = { id: attemptId, providerId, method, mode: auth.method, expiresAt, timer, expired: false, completing: false };
            return { attemptId, method: auth.method, instructions: auth.instructions, expiresAt, url };
        });
    }
    async complete(id: string, attemptId: string, code?: string): Promise<OpenCodeSetupState> {
        const lease = this.require(id), attempt = lease.attempt;
        if (!attempt || attempt.id !== attemptId) throw new SetupError('cancelled', 'This authorization attempt is no longer active. Start again.');
        if (attempt.expired || Date.now() >= attempt.expiresAt) { this.cancel(id); throw new SetupError('expired', 'Authorization expired. Start sign-in again.'); }
        if (attempt.completing) throw new SetupError('busy', 'Authorization is already being completed.');
        if (attempt.mode === 'code' && !code?.trim()) throw new SetupError('invalid-input', 'Enter the authorization code.');
        attempt.completing = true;
        try {
            const result = await this.request(lease, `/provider/${encodeURIComponent(attempt.providerId)}/oauth/callback`, 'POST', { method: attempt.method, ...(code ? { code: code.trim() } : {}) }, Math.max(1, attempt.expiresAt - Date.now()));
            this.require(id);
            if (lease.attempt !== attempt) throw new SetupError('cancelled', 'Authorization was cancelled.');
            if (result !== true) throw new SetupError('failed', 'The provider did not complete authorization. Retry sign-in.');
            clearTimeout(attempt.timer); lease.attempt = undefined;
            this.changed(); this.restart(lease);
            const state = await this.discover(lease);
            if (!state.providers.some(provider => provider.id === attempt.providerId && provider.connected))
                throw new SetupError('failed', 'Authorization returned without saved credentials. Retry sign-in or use the managed login flow.');
            return state;
        } catch (error) {
            if (attempt.expired || Date.now() >= attempt.expiresAt) { this.cancel(id); throw new SetupError('expired', 'Authorization expired. Start sign-in again.'); }
            if (this.lease === lease && lease.attempt === attempt) this.cancel(id);
            throw error;
        }
    }
    cancel(id: string): void {
        const lease = this.require(id);
        if (lease.attempt) clearTimeout(lease.attempt.timer);
        lease.attempt = undefined;
        this.restart(lease); this.changed();
    }
    async select(id: string, providerId: string, modelId: string): Promise<OpenCodeSetupState> {
        return this.exclusive(id, async lease => {
            const provider = this.provider(lease, providerId);
            if (!provider.models.some(m => m.id === modelId)) throw new SetupError('unavailable-model', 'That model is no longer available. Refresh and choose another model.');
            this.verified = undefined;
            this.selection = { providerId, modelId };
            await fs.mkdir(path.dirname(this.selectionFile), { recursive: true });
            await fs.writeFile(this.selectionFile, JSON.stringify(this.selection), { mode: 0o600 });
            return this.state(lease);
        });
    }
    async verify(id: string): Promise<OpenCodeSetupState> {
        return this.exclusive(id, async lease => {
            this.verified = undefined;
            const selected = this.selection;
            if (!selected) throw new SetupError('invalid-input', 'Select a model first.');
            const provider = this.provider(lease, selected.providerId);
            if (!provider.connected) throw new SetupError('invalid-credentials', 'Connect this provider before verifying it.');
            if (!provider.models.some(m => m.id === selected.modelId)) throw new SetupError('unavailable-model', 'Choose an available model.');
            let sessionId: string | undefined;
            try {
                const session = z.object({ id: z.string() }).parse(await this.request(lease, '/session', 'POST', { title: 'Rowboat connection verification', permission: [{ permission: '*', pattern: '*', action: 'deny' }] }));
                sessionId = session.id;
                const result = z.object({ info: z.object({ error: z.unknown().optional(), providerID: z.string(), modelID: z.string(), finish: z.string().optional() }), parts: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(
                    await this.request(lease, `/session/${encodeURIComponent(sessionId)}/message`, 'POST', {
                        model: { providerID: selected.providerId, modelID: selected.modelId.slice(selected.providerId.length + 1) },
                        tools: { '*': false }, parts: [{ type: 'text', text: 'Reply with only OK. Do not use any tools.' }],
                    }, 60_000));
                if (result.info.error) {
                    const error = result.info.error as { name?: string; data?: { statusCode?: number } };
                    if (error.name === 'ProviderAuthError' || [401, 403].includes(error.data?.statusCode ?? 0)) throw new SetupError('invalid-credentials', 'The provider rejected these credentials. Reconnect and try again.');
                    if (error.data?.statusCode === 429) throw new SetupError('rate-limit', 'The provider is rate limited or out of quota. Check your account and retry.');
                    throw new SetupError('failed', 'The model could not complete verification. Check credentials, account access and model availability, then retry.');
                }
                if (result.info.providerID !== selected.providerId || `${selected.providerId}/${result.info.modelID}` !== selected.modelId || !result.info.finish || !result.parts.some(p => p.type === 'text' && p.text?.trim()))
                    throw new SetupError('failed', 'The selected model did not return a completed response. Choose another model or retry.');
                this.require(id);
                this.verified = { ...selected, at: Date.now(), generation: this.generation };
                return this.state(lease);
            } finally {
                if (sessionId && this.lease === lease) {
                    await this.request(lease, `/session/${encodeURIComponent(sessionId)}/abort`, 'POST', undefined, 3000).catch(() => {});
                    await this.request(lease, `/session/${encodeURIComponent(sessionId)}`, 'DELETE', undefined, 3000).catch(() => {});
                }
            }
        });
    }
}
export const openCodeSetup = new OpenCodeSetupService();
