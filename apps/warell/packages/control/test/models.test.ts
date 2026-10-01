import { describe, expect, it } from 'vitest';
import { applyPolicy, filterCatalog, type ModelPolicy } from '../src/models.js';

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

describe('filterCatalog', () => {
  it('returns null on a catalog it cannot read', () => {
    expect(filterCatalog(policy, '{"nodata":1}')).toBeNull();
    expect(filterCatalog(policy, 'x')).toBeNull();
  });
});
