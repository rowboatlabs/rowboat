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
  listModelsForProvider: vi.fn<(config: unknown) => Promise<string[]>>(async () => ['live-model-1']),
  listGatewayImageModels: vi.fn(async () => ['google/gemini-2.5-flash-image']),
  listImageModelsForProvider: vi.fn<(config: unknown) => Promise<string[]>>(async () => ['google/gemini-2.5-flash-image', 'x-ai/grok-imagine-image-quality']),
  listOnboardingModels: vi.fn(async () => ({ providers: [] as Array<{ id: string; name: string; models: Array<{ id: string; name?: string; reasoning?: boolean }> }> })),
  getImageModelIds: vi.fn<(flavor: string) => Promise<string[] | null>>(async () => ['gemini-3-pro-image', 'gemini-2.5-flash-image']),
  getDefaultModelAndProvider: vi.fn(async () => ({ provider: 'openai', model: 'gpt-5.4' })),
  getConfig: vi.fn(async (): Promise<unknown> => {
    throw new Error('no models.json');
  }),
}));

vi.mock('../account/account.js', () => ({ isSignedIn: mocks.isSignedIn }));
vi.mock('../auth/chatgpt-auth.js', () => ({ getChatGPTStatus: mocks.getChatGPTStatus }));
vi.mock('./gateway.js', () => ({ listGatewayModels: mocks.listGatewayModels, listGatewayImageModels: mocks.listGatewayImageModels }));
vi.mock('./codex.js', () => ({ listCodexModels: mocks.listCodexModels }));
vi.mock('./models.js', () => ({ listModelsForProvider: mocks.listModelsForProvider, listImageModelsForProvider: mocks.listImageModelsForProvider }));
vi.mock('./models-dev.js', () => ({ listOnboardingModels: mocks.listOnboardingModels, getImageModelIds: mocks.getImageModelIds }));
vi.mock('./defaults.js', () => ({ getDefaultModelAndProvider: mocks.getDefaultModelAndProvider }));
vi.mock('../di/container.js', () => ({
  default: { resolve: () => ({ getConfig: mocks.getConfig }) },
}));

import { getImageModelCatalog, getModelCatalog, __resetModelCatalogForTests } from './catalog.js';

// v2 config: providers keyed by instance id, flavor explicit inside (the
// helper defaults flavor to the key — one instance per flavor today).
function serveConfig(
  providers: Record<string, Record<string, unknown>>,
  assistantModel?: { provider: string; model: string },
): void {
  mocks.getConfig.mockImplementation(async () => ({
    version: 2,
    providers: Object.fromEntries(
      Object.entries(providers).map(([id, entry]) => [id, { flavor: id, ...entry }]),
    ),
    ...(assistantModel ? { assistantModel } : {}),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetModelCatalogForTests();
  mocks.isSignedIn.mockResolvedValue(false);
  mocks.getChatGPTStatus.mockResolvedValue({ signedIn: false });
  mocks.listOnboardingModels.mockResolvedValue({ providers: [] });
  mocks.listModelsForProvider.mockResolvedValue(['live-model-1']);
  mocks.listGatewayImageModels.mockResolvedValue(['google/gemini-2.5-flash-image']);
  mocks.listImageModelsForProvider.mockResolvedValue(['google/gemini-2.5-flash-image', 'x-ai/grok-imagine-image-quality']);
  mocks.getImageModelIds.mockResolvedValue(['gemini-3-pro-image', 'gemini-2.5-flash-image']);
  mocks.getDefaultModelAndProvider.mockResolvedValue({ provider: 'openai', model: 'gpt-5.4' });
  mocks.getConfig.mockRejectedValue(new Error('no models.json'));
});

describe('getModelCatalog', () => {
  it('treats rowboat, codex, and BYOK providers as one uniform provider list', async () => {
    mocks.isSignedIn.mockResolvedValue(true);
    mocks.getChatGPTStatus.mockResolvedValue({ signedIn: true });
    serveConfig({
      ollama: { baseURL: 'http://localhost:11434' },
    });
    mocks.listModelsForProvider.mockResolvedValue(['llama3', 'qwen3']);

    const catalog = await getModelCatalog();

    expect(catalog.providers.map((p) => p.id)).toEqual(['rowboat', 'codex', 'ollama']);
    expect(catalog.providers.every((p) => p.status === 'ok')).toBe(true);
    expect(catalog.providers[0].models).toEqual([{ id: 'google/gemini-3.5-flash', reasoning: true }]);
    expect(catalog.providers[2]).toMatchObject({ flavor: 'ollama', models: [{ id: 'llama3' }, { id: 'qwen3' }] });
    expect(catalog.defaultModel).toEqual({ provider: 'openai', model: 'gpt-5.4' });
  });

  it('orders the assistant model provider first among configured providers', async () => {
    serveConfig(
      {
        openrouter: { apiKey: 'sk-1' },
        ollama: { baseURL: 'http://localhost:11434' },
      },
      { provider: 'ollama', model: 'llama3' },
    );
    mocks.listModelsForProvider.mockResolvedValue(['m']);

    const catalog = await getModelCatalog();
    expect(catalog.providers.map((p) => p.id)).toEqual(['ollama', 'openrouter']);
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
    serveConfig({ ollama: { baseURL: 'http://localhost:11434' } });
    mocks.listModelsForProvider.mockRejectedValue(new Error('connection refused'));

    const catalog = await getModelCatalog();
    expect(catalog.providers[0]).toMatchObject({
      id: 'ollama',
      status: 'error',
      error: 'connection refused',
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

describe('getImageModelCatalog', () => {
  it('lists every image flavor from its own source — never a typed id', async () => {
    mocks.isSignedIn.mockResolvedValue(true);
    mocks.getChatGPTStatus.mockResolvedValue({ signedIn: true });
    serveConfig({
      openrouter: { apiKey: 'sk-1' },
      google: { apiKey: 'g-1' },
      anthropic: { apiKey: 'a-1' },
    });

    const catalog = await getImageModelCatalog();

    // codex and anthropic can't generate images here — not offered at all.
    expect(catalog.providers.map((p) => p.id)).toEqual(['rowboat', 'openrouter', 'google']);
    // Gateway allowlist.
    expect(catalog.providers[0]).toEqual({
      id: 'rowboat', flavor: 'rowboat', status: 'ok', models: ['google/gemini-2.5-flash-image'],
    });
    // OpenRouter's own output-modality-filtered catalog.
    expect(catalog.providers[1]).toMatchObject({ flavor: 'openrouter', status: 'ok' });
    expect(catalog.providers[1].models).toContain('x-ai/grok-imagine-image-quality');
    // google: the models.dev catalog filtered by output modality.
    expect(catalog.providers[2]).toEqual({
      id: 'google', flavor: 'google', status: 'ok', models: ['gemini-3-pro-image', 'gemini-2.5-flash-image'],
    });
    expect(mocks.getImageModelIds).toHaveBeenCalledWith('google');
    expect(mocks.listModelsForProvider).not.toHaveBeenCalled();
  });

  it('lists local flavors unfiltered — no image metadata exists to filter on', async () => {
    serveConfig({
      ollama: { baseURL: 'http://localhost:11434' },
      'openai-compatible': { baseURL: 'http://localhost:1234/v1' },
      orcarouter: { apiKey: 'sk-orca' },
    });
    mocks.listModelsForProvider.mockResolvedValue(['qwen3', 'gemma3']);

    const catalog = await getImageModelCatalog();

    expect(catalog.providers).toEqual([
      { id: 'ollama', flavor: 'ollama', status: 'ok', models: ['qwen3', 'gemma3'] },
      { id: 'openai-compatible', flavor: 'openai-compatible', status: 'ok', models: ['qwen3', 'gemma3'] },
      { id: 'orcarouter', flavor: 'orcarouter', status: 'ok', models: ['qwen3', 'gemma3'] },
    ]);
    expect(mocks.listImageModelsForProvider).not.toHaveBeenCalled();
  });

  it('reports a failed image listing as status error instead of dropping the provider', async () => {
    mocks.isSignedIn.mockResolvedValue(true);
    mocks.listGatewayImageModels.mockRejectedValue(new Error('Gateway /v1/models?output_modalities=image failed: 503'));

    const catalog = await getImageModelCatalog();
    expect(catalog.providers[0]).toMatchObject({
      id: 'rowboat',
      status: 'error',
      error: 'Gateway /v1/models?output_modalities=image failed: 503',
      models: [],
    });
  });

  it('an Ollama that is not running is an error row (Retry), not an empty list', async () => {
    serveConfig({ ollama: { baseURL: 'http://localhost:11434' } });
    mocks.listModelsForProvider.mockRejectedValue(new Error('fetch failed'));

    const catalog = await getImageModelCatalog();
    expect(catalog.providers[0]).toMatchObject({ id: 'ollama', status: 'error', error: 'fetch failed', models: [] });
  });

  it('reports a missing models.dev cache as retryable rather than "no image models"', async () => {
    serveConfig({ openai: { apiKey: 'sk-1' } });
    mocks.getImageModelIds.mockResolvedValue(null);

    const catalog = await getImageModelCatalog();
    expect(catalog.providers[0]).toMatchObject({ id: 'openai', status: 'error', models: [] });
    expect(catalog.providers[0].error).toMatch(/catalog unavailable/i);
  });
});
