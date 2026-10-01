import { describe, expect, it } from 'vitest';
import { applyPolicy, displayName, presentCatalog, type ModelPolicy } from '../src/models.js';

const policy: ModelPolicy = { models: ['a/one', 'b/two'], settings: { reasoning: { enabled: false } } };

describe('applyPolicy', () => {
  it('forces the settings over what core sent', () => {
    const r = applyPolicy(policy, '/chat/completions', JSON.stringify({ model: 'a/one', reasoning: { effort: 'high' }, stream: true }));
    expect(r.ok && JSON.parse(r.body)).toEqual({ model: 'a/one', models: ['a/one', 'b/two'], reasoning: { enabled: false }, stream: true });
  });

  it('serves the default when no model is named', () => {
    const r = applyPolicy(policy, '/chat/completions', '{}');
    expect(r).toMatchObject({ ok: true, requested: null, served: 'a/one' });
  });

  it('refuses a body that is not a JSON object', () => {
    expect(applyPolicy(policy, '/chat/completions', 'nope')).toMatchObject({ ok: false, status: 400 });
    expect(applyPolicy(policy, '/chat/completions', '[]')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('presentCatalog', () => {
  it('drops the vendor prefix from names, and keeps everything else', () => {
    const raw = JSON.stringify({ data: [{ id: 'a/one', name: 'Alpha: One Mini', context_length: 8 }, { id: 'z/zed' }] });
    expect(JSON.parse(presentCatalog(null, raw)!)).toEqual({ data: [{ id: 'a/one', name: 'One Mini', context_length: 8 }, { id: 'z/zed' }] });
  });

  it('keeps only the policy models', () => {
    const raw = JSON.stringify({ data: [{ id: 'a/one' }, { id: 'z/zed' }, { id: 'b/two' }] });
    expect(JSON.parse(presentCatalog(policy, raw)!).data.map((m: { id: string }) => m.id)).toEqual(['a/one', 'b/two']);
  });

  it('returns null on a catalog it cannot read', () => {
    expect(presentCatalog(policy, '{"nodata":1}')).toBeNull();
    expect(presentCatalog(null, 'x')).toBeNull();
  });
});

describe('displayName', () => {
  it('keeps a name without a prefix, or one that would end empty', () => {
    expect(displayName('DeepSeek: DeepSeek V4.1 Flash')).toBe('DeepSeek V4.1 Flash');
    expect(displayName('GPT-6 Luna')).toBe('GPT-6 Luna');
    expect(displayName('Odd:')).toBe('Odd:');
  });
});
