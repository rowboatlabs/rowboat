import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The unified model catalog: every provider (rowboat gateway, codex, BYOK,
 * local) flows through one function with per-provider status and a
 * credential-fingerprinted list cache. These tests pin the policy: who gets
 * discovered, which lister serves which flavor, how failures surface, and
 * when the cache is (in)validated.
 */

const mocks = vi.hoisted(() => ({
  isSignedIn: vi.fn(async () => false),
  getChatGPTStatus: vi.fn(async () => ({ signedIn: false })),
  listGatewayModels: vi.fn(async () => ({
    providers: [{ id: 'rowboat', name: 'Rowboat', models: [{ id: 'google/gemini-3.5-flash', reasoning: true }] }],
  })),
  listCodexModels: vi.fn(async () => ({
    providers: [{ id: 'codex', name: 'OpenAI Codex', models: [{ id: 'gpt-5.6-sol', reasoning: true }] }],
  })),
  listModelsForProvider: vi.fn(async (_config: unknown) => ['live-model-1']),
  listOnboardingModels: vi.fn(async () => ({ providers: [] as Array<{ id: string; name: string; models: Array<{ id: string; name?: string; reasoning?: boolean }> }> })),
  getDefaultModelAndProvider: vi.fn(async () => ({ provider: 'openai', model: 'gpt-5.4' })),
  getConfig: vi.fn(async (): Promise<unknown> => {
    throw new Error('no models.json');
  }),
}));

vi.mock('../account/account.js', () => ({ isSignedIn: mocks.isSignedIn }));
vi.mock('../auth/chatgpt-auth.js', () => ({ getChatGPTStatus: mocks.getChatGPTStatus }));
vi.mock('./gateway.js', () => ({ listGatewayModels: mocks.listGatewayModels }));
vi.mock('./codex.js', () => ({ listCodexModels: mocks.listCodexModels }));
vi.mock('./models.js', () => ({ listModelsForProvider: mocks.listModelsForProvider }));
vi.mock('./models-dev.js', () => ({ listOnboardingModels: mocks.listOnboardingModels }));
vi.mock('./defaults.js', () => ({ getDefaultModelAndProvider: mocks.getDefaultModelAndProvider }));
vi.mock('../di/container.js', () => ({
  default: { resolve: () => ({ getConfig: mocks.getConfig }) },
}));

import { getModelCatalog, __resetModelCatalogForTests } from './catalog.js';

function serveConfig(providers: Record<string, unknown>, defaultFlavor = 'openai'): void {
  mocks.getConfig.mockImplementation(async () => ({
    provider: { flavor: defaultFlavor },
    model: 'gpt-5.4',
    providers,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetModelCatalogForTests();
  mocks.isSignedIn.mockResolvedValue(false);
  mocks.getChatGPTStatus.mockResolvedValue({ signedIn: false });
  mocks.listOnboardingModels.mockResolvedValue({ providers: [] });
  mocks.getDefaultModelAndProvider.mockResolvedValue({ provider: 'openai', model: 'gpt-5.4' });
  mocks.getConfig.mockRejectedValue(new Error('no models.json'));
});

describe('getModelCatalog', () => {
  it('treats rowboat, codex, and BYOK providers as one uniform provider list', async () => {
    mocks.isSignedIn.mockResolvedValue(true);
    mocks.getChatGPTStatus.mockResolvedValue({ signedIn: true });
    serveConfig({
      ollama: { baseURL: 'http://localhost:11434', model: 'llama3' },
    });
    mocks.listModelsForProvider.mockResolvedValue(['llama3', 'qwen3']);

    const catalog = await getModelCatalog();

    expect(catalog.providers.map((p) => p.id)).toEqual(['rowboat', 'codex', 'ollama']);
    expect(catalog.providers.every((p) => p.status === 'ok')).toBe(true);
    expect(catalog.providers[0].models).toEqual([{ id: 'google/gemini-3.5-flash', reasoning: true }]);
    expect(catalog.providers[2]).toMatchObject({ savedModel: 'llama3', models: [{ id: 'llama3' }, { id: 'qwen3' }] });
    expect(catalog.defaultModel).toEqual({ provider: 'openai', model: 'gpt-5.4' });
  });

  it('skips providers-map entries that carry no credential', async () => {
    serveConfig({
      openai: { model: 'gpt-5.4' }, // no key — not connected
      anthropic: { apiKey: 'sk-b' },
    });
    mocks.listModelsForProvider.mockResolvedValue(['claude-opus-4-8']);

    const catalog = await getModelCatalog();
    expect(catalog.providers.map((p) => p.id)).toEqual(['anthropic']);
  });

  it('serves cloud flavors from the models.dev catalog and only lists live when it is empty', async () => {
    serveConfig({ openai: { apiKey: 'sk-a' } });
    mocks.listOnboardingModels.mockResolvedValue({
      providers: [{ id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-5.4', reasoning: true }] }],
    });

    const catalog = await getModelCatalog();
    expect(catalog.providers[0].models).toEqual([{ id: 'gpt-5.4', reasoning: true }]);
    expect(mocks.listModelsForProvider).not.toHaveBeenCalled();

    // Empty models.dev cache (fresh offline install) → live listing fallback.
    __resetModelCatalogForTests();
    mocks.listOnboardingModels.mockResolvedValue({ providers: [] });
    mocks.listModelsForProvider.mockResolvedValue(['gpt-5.4-live']);
    const fallback = await getModelCatalog();
    expect(fallback.providers[0].models).toEqual([{ id: 'gpt-5.4-live' }]);
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(1);
  });

  it('reports a failed provider as status error instead of dropping it', async () => {
    serveConfig({ ollama: { baseURL: 'http://localhost:11434', model: 'llama3' } });
    mocks.listModelsForProvider.mockRejectedValue(new Error('connection refused'));

    const catalog = await getModelCatalog();
    expect(catalog.providers[0]).toMatchObject({
      id: 'ollama',
      status: 'error',
      error: 'connection refused',
      savedModel: 'llama3',
      models: [],
    });
  });

  it('caches successful lists per credential fingerprint and refetches when credentials change', async () => {
    serveConfig({ openrouter: { apiKey: 'sk-1' } });
    mocks.listModelsForProvider.mockResolvedValue(['a/b']);

    await getModelCatalog();
    await getModelCatalog();
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(1);

    // Same provider, new key → the fingerprint changes → refetch.
    serveConfig({ openrouter: { apiKey: 'sk-2' } });
    await getModelCatalog();
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(2);
  });

  it('refreshProvider bypasses the cache for that provider only', async () => {
    serveConfig({
      openrouter: { apiKey: 'sk-1' },
      ollama: { baseURL: 'http://localhost:11434' },
    });
    mocks.listModelsForProvider.mockResolvedValue(['m']);

    await getModelCatalog();
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(2);

    await getModelCatalog({ refreshProvider: 'ollama' });
    // Only ollama refetched; openrouter served from cache.
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(3);
    const lastCall = mocks.listModelsForProvider.mock.calls.at(-1)?.[0] as { flavor: string };
    expect(lastCall.flavor).toBe('ollama');
  });

  it('caches failures briefly so every catalog build does not re-pay the fetch timeout', async () => {
    serveConfig({ ollama: { baseURL: 'http://localhost:11434' } });
    mocks.listModelsForProvider.mockRejectedValue(new Error('down'));

    await getModelCatalog();
    await getModelCatalog();
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(1);

    // …but an explicit refresh always retries.
    await getModelCatalog({ refreshProvider: 'ollama' });
    expect(mocks.listModelsForProvider).toHaveBeenCalledTimes(2);
  });
});
