import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedOrgSlug } from './orgs.js';

describe('generated org addresses', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['towerk', 'towerk'],
    ['  Tower K! ', 'tower-k'],
    ['www', 'www'],
    ['团队 🚀', 'server'],
    ['a'.repeat(128), 'a'.repeat(35)],
    [`${'a'.repeat(34)} team`, 'a'.repeat(34)],
  ])('gives %j a valid address with a suffix, preserving room under the cap', (name, prefix) => {
    const slug = generatedOrgSlug(name);
    expect(slug).toMatch(new RegExp(`^${prefix}-[a-z0-9]{4}$`));
    expect(slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/);
  });

  it('generates a new suffix even when the name is unchanged', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const first = generatedOrgSlug('towerk');
    random.mockReturnValue(0.5);
    expect(generatedOrgSlug('towerk')).not.toBe(first);
  });
});
