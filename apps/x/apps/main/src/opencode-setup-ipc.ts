import { shell, type IpcMainInvokeEvent } from 'electron';
import { openCodeSetup, safeSetupError, SetupError } from '@x/core/dist/code-mode/acp/opencode-setup.js';
import { startOpenCodeLogin, stopOpenCodeLogin, readOpenCodeLogin, writeOpenCodeLogin } from '@x/core/dist/code-mode/acp/opencode-login.js';

async function result<T>(work: () => T | Promise<T>) {
    try { return { success: true as const, data: await work() }; }
    catch (error) { return { success: false as const, error: safeSetupError(error) }; }
}
const owners = new Map<number, string>();
const watched = new Set<number>();
type Setup = { setupId: string };

export const openCodeSetupHandlers = {
    'opencodeSetup:openAccount': async () => result(async () => { await shell.openExternal('https://opencode.ai/auth'); return null; }),
    'opencodeSetup:start': async (event: IpcMainInvokeEvent) => result(async () => {
        const owner = event.sender.id;
        if (!watched.has(owner)) {
            watched.add(owner);
            event.sender.once('destroyed', () => {
                const id = owners.get(owner); if (id) stopOpenCodeLogin(id);
                openCodeSetup.stopOwner(String(owner)); owners.delete(owner); watched.delete(owner);
            });
        }
        const state = await openCodeSetup.start(String(owner)); owners.set(owner, state.setupId); return state;
    }),
    'opencodeSetup:stop': async (event: IpcMainInvokeEvent, args: { setupId?: string }) => {
        const id = args.setupId ?? owners.get(event.sender.id);
        if (id) { stopOpenCodeLogin(id); openCodeSetup.stop(id); }
        else openCodeSetup.stopOwner(String(event.sender.id));
        if (!args.setupId || owners.get(event.sender.id) === args.setupId) owners.delete(event.sender.id);
        return { success: true as const, data: null };
    },
    'opencodeSetup:refresh': async (_event: IpcMainInvokeEvent, args: Setup) => result(() => openCodeSetup.refresh(args.setupId)),
    'opencodeSetup:saveKey': async (_event: IpcMainInvokeEvent, args: Setup & { providerId: string; method: number; key: string }) => result(() => openCodeSetup.saveKey(args.setupId, args.providerId, args.method, args.key)),
    'opencodeSetup:disconnect': async (_event: IpcMainInvokeEvent, args: Setup & { providerId: string }) => result(() => openCodeSetup.disconnect(args.setupId, args.providerId)),
    'opencodeSetup:authorize': async (_event: IpcMainInvokeEvent, args: Setup & { providerId: string; method: number; inputs: Record<string, string> }) => result(async () => {
        const auth = await openCodeSetup.authorize(args.setupId, args.providerId, args.method, args.inputs);
        try { await shell.openExternal(auth.url); }
        catch { openCodeSetup.cancel(args.setupId); throw new SetupError('failed', 'Could not open the browser. Retry sign-in or use the managed login flow.'); }
        const { attemptId, method, instructions, expiresAt } = auth;
        return { attemptId, method, instructions, expiresAt };
    }),
    'opencodeSetup:complete': async (_event: IpcMainInvokeEvent, args: Setup & { attemptId: string; code?: string }) => result(() => openCodeSetup.complete(args.setupId, args.attemptId, args.code)),
    'opencodeSetup:cancel': async (_event: IpcMainInvokeEvent, args: Setup) => result(() => { openCodeSetup.cancel(args.setupId); return null; }),
    'opencodeSetup:select': async (_event: IpcMainInvokeEvent, args: Setup & { providerId: string; modelId: string }) => result(() => openCodeSetup.select(args.setupId, args.providerId, args.modelId)),
    'opencodeSetup:verify': async (_event: IpcMainInvokeEvent, args: Setup) => result(() => openCodeSetup.verify(args.setupId)),
    'opencodeSetup:loginStart': async (_event: IpcMainInvokeEvent, args: Setup) => result(() => { startOpenCodeLogin(args.setupId); return null; }),
    'opencodeSetup:loginRead': async (_event: IpcMainInvokeEvent, args: Setup) => result(() => readOpenCodeLogin(args.setupId)),
    'opencodeSetup:loginInput': async (_event: IpcMainInvokeEvent, args: Setup & { input: string }) => result(() => { writeOpenCodeLogin(args.setupId, args.input); return null; }),
    'opencodeSetup:loginStop': async (_event: IpcMainInvokeEvent, args: Setup) => result(() => { stopOpenCodeLogin(args.setupId); return null; }),
};
