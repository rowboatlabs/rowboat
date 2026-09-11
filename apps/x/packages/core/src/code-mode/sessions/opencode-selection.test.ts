import { expect, it, vi } from 'vitest';
import { CodeSessionService } from './service.js';

function fixture() {
    const get = vi.fn().mockResolvedValue({ id: 's', agent: 'opencode', cwd: '/worktree', agentModel: 'provider/old', agentEffort: 'high', agentMode: 'build' });
    const save = vi.fn();
    const listModelOptions = vi.fn();
    const isRunning = vi.fn().mockReturnValue(false);
    const service = new CodeSessionService({ codeSessionsRepo: { get, save }, codeModeManager: { listModelOptions, isRunning }, sessionBus: { subscribe: vi.fn() } } as unknown as ConstructorParameters<typeof CodeSessionService>[0]);
    return { service, save, listModelOptions, isRunning };
}

it('does not persist a model change rejected by the engine', async () => {
    const { service, save, listModelOptions } = fixture();
    listModelOptions.mockRejectedValue(new Error('Model unavailable'));
    await expect(service.update('s', { agentModel: 'provider/missing' })).rejects.toThrow('unavailable');
    expect(save).not.toHaveBeenCalled();
});

it('discovers in the worktree and clears effort when the accepted model does not advertise it', async () => {
    const { service, save, listModelOptions } = fixture();
    listModelOptions.mockResolvedValue({ models: [], efforts: [], currentModel: 'provider/new', currentMode: 'build' });
    await service.update('s', { agentModel: 'provider/new' });
    expect(listModelOptions).toHaveBeenCalledWith('opencode', '/worktree', 'provider/new', undefined, 'build');
    expect(save.mock.calls[0][0]).toMatchObject({ agentModel: 'provider/new', agentEffort: undefined });
});

it('requires stopping the current turn before changing approval policy', async () => {
    const { service, save, isRunning } = fixture();
    isRunning.mockReturnValue(true);
    await expect(service.update('s', { policy: 'ask' })).rejects.toThrow('Stop the current coding operation');
    expect(save).not.toHaveBeenCalled();
});
