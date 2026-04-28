import { AsyncLocalStorage } from 'node:async_hooks';

export type UseCase = 'copilot_chat' | 'track_block' | 'meeting_note' | 'knowledge_sync';

export interface UseCaseContext {
  useCase: UseCase;
  subUseCase?: string;
  agentName?: string;
}

const storage = new AsyncLocalStorage<UseCaseContext>();

export function withUseCase<T>(ctx: UseCaseContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Permanently install a use-case context for the current async chain.
 * Use inside generator functions where wrapping with `withUseCase()` doesn't
 * compose. Child async work (e.g. tool execution) will inherit it.
 */
export function enterUseCase(ctx: UseCaseContext): void {
  storage.enterWith(ctx);
}

export function getCurrentUseCase(): UseCaseContext | undefined {
  return storage.getStore();
}
