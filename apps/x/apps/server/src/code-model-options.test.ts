import { afterEach, expect, it, vi } from 'vitest';
import container from '@x/core/dist/di/container.js';
import { ipc } from '@x/shared';
import { createCoreRpcHandlers } from './core-deps.js';

afterEach(() => vi.restoreAllMocks());

it('forwards project and current model configuration through the server discovery handler', async () => {
  const options = { models: [{ value: 'opencode/model', label: 'Model' }], efforts: [] };
  const listModelOptions = vi.fn().mockResolvedValue(options);
  vi.spyOn(container, 'resolve').mockReturnValue({ listModelOptions });
  const args = ipc.validateRequest('codeMode:listModelOptions', {
    agent: 'opencode', cwd: 'C:\\Projects with spaces\\worktree',
    model: 'opencode/model', effort: 'high', mode: 'plan',
  });
  const handler = createCoreRpcHandlers()['codeMode:listModelOptions']!;
  expect(await handler(args)).toEqual(options);
  expect(listModelOptions).toHaveBeenCalledExactlyOnceWith('opencode', args.cwd, args.model, args.effort, args.mode, false);
});
