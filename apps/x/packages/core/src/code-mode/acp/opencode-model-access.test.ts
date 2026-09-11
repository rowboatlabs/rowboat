import { expect, it } from 'vitest';
import { openCodeModelAccess } from './opencode-model-access.js';

const catalog = { all: [
    { id: 'opencode', models: {
        public: { id: 'public', name: 'No free keyword', cost: { input: 0, output: 0 } },
        paid: { id: 'paid', name: 'Misleading Free model', cost: { input: 1, output: 2 } },
        partial: { id: 'partial', cost: { input: 0, output: 2 } },
        unknown: { id: 'unknown' },
    } },
    { id: 'opencode-go', models: { go: { id: 'go', cost: { input: 0, output: 0 } } } },
    { id: 'other', models: { unrelated: { id: 'unrelated', cost: { input: 0, output: 0 } } } },
] };

it('allows only confirmed public free models without managed account credentials', () => {
    const access = openCodeModelAccess(new Set(['other']), catalog);
    expect(access.groups).toEqual(['free']);
    expect([...access.models]).toEqual([['opencode/public', 'free']]);
});
it('shows only Go when Go is connected, hiding even public Zen models', () => {
    const access = openCodeModelAccess(new Set(['opencode-go']), catalog);
    expect(access.groups).toEqual(['go']);
    expect([...access.models.keys()]).toEqual(['opencode-go/go']);
});
it('shows only Zen when Zen is connected', () => {
    const access = openCodeModelAccess(new Set(['opencode']), catalog);
    expect(access.groups).toEqual(['zen']);
    expect([...access.models.keys()]).toEqual(['opencode/public', 'opencode/paid', 'opencode/partial', 'opencode/unknown']);
});
it('advertises both services only while both are connected, reverting to free on disconnect', () => {
    const credentials = new Set(['opencode', 'opencode-go']);
    expect(openCodeModelAccess(credentials, catalog).groups).toEqual(['zen', 'go']);
    credentials.delete('opencode');
    expect(openCodeModelAccess(credentials, catalog).models.has('opencode/paid')).toBe(false);
    credentials.clear();
    expect([...openCodeModelAccess(credentials, catalog).models.keys()]).toEqual(['opencode/public']);
});
it('rejects malformed catalog data without exposing it in the error', () => {
    expect(() => openCodeModelAccess(new Set(), { secret: 'do-not-echo' })).toThrow('model access could not be read');
});
