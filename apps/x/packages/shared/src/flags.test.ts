import { describe, expect, it } from 'vitest';

import { spacesOnly } from './flags.js';

describe('spacesOnly', () => {
  it('is on for ROWBOAT_SPACES_ONLY=1 or true', () => {
    expect(spacesOnly({ ROWBOAT_SPACES_ONLY: '1' })).toBe(true);
    expect(spacesOnly({ ROWBOAT_SPACES_ONLY: 'true' })).toBe(true);
  });

  it('is off when unset or anything else', () => {
    expect(spacesOnly({})).toBe(false);
    expect(spacesOnly({ ROWBOAT_SPACES_ONLY: '0' })).toBe(false);
    expect(spacesOnly({ ROWBOAT_SPACES_ONLY: 'yes' })).toBe(false);
  });
});
