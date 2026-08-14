import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MergeFixture } from '@rowboat/spaces-protocol';
import { merge3 } from '../src/merge.js';

const fixturesDir = fileURLToPath(new URL('../../protocol/fixtures/merge/', import.meta.url));

describe('golden merge fixtures (the conformance suite)', () => {
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort();
  it('has the six fixtures', () => {
    expect(files.length).toBe(6);
  });

  for (const file of files) {
    it(file, () => {
      const fixture = MergeFixture.parse(JSON.parse(readFileSync(fixturesDir + file, 'utf8')));
      const result = merge3(fixture.base, fixture.current, fixture.proposed);
      if (fixture.expected.outcome === 'merged') {
        expect(result.outcome).toBe('merged');
        if (result.outcome === 'merged') {
          expect(result.content).toBe(fixture.expected.content);
        }
      } else {
        expect(result.outcome).toBe('conflict');
        if (result.outcome === 'conflict') {
          expect(
            result.regions.map(({ baseStart, baseEnd }) => ({ baseStart, baseEnd })),
          ).toEqual(fixture.expected.regions);
        }
      }
    });
  }
});

describe('merge3 beyond the fixtures', () => {
  it('creation race: both sides wrote a new file (base empty) — conflicts unless identical', () => {
    const r = merge3('', 'A\n', 'B\n');
    expect(r.outcome).toBe('conflict');
    if (r.outcome === 'conflict') {
      expect(r.regions).toEqual([{ baseStart: 1, baseEnd: 0, current: ['A'], proposed: ['B'] }]);
    }
    expect(merge3('', 'A\n', 'A\n')).toEqual({ outcome: 'merged', content: 'A\n' });
  });

  it('one side unchanged: proposal applies verbatim', () => {
    expect(merge3('a\nb\n', 'a\nb\n', 'a\nB\n')).toEqual({ outcome: 'merged', content: 'a\nB\n' });
    expect(merge3('a\nb\n', 'A\nb\n', 'a\nb\n')).toEqual({ outcome: 'merged', content: 'A\nb\n' });
  });

  it('insertion strictly inside the other side’s rewritten range conflicts', () => {
    const base = 'l1\nl2\nl3\nl4\n';
    const current = 'l1\nX\nY\nl4\n'; // rewrote lines 2-3
    const proposed = 'l1\nl2\nnew\nl3\nl4\n'; // inserted between 2 and 3
    const r = merge3(base, current, proposed);
    expect(r.outcome).toBe('conflict');
    if (r.outcome === 'conflict') {
      expect(r.regions.map(({ baseStart, baseEnd }) => ({ baseStart, baseEnd }))).toEqual([
        { baseStart: 2, baseEnd: 3 },
      ]);
      expect(r.regions[0]!.current).toEqual(['X', 'Y']);
      expect(r.regions[0]!.proposed).toEqual(['l2', 'new', 'l3']);
    }
  });

  it('insertion at the boundary of the other side’s edit merges cleanly', () => {
    const base = 'l1\nl2\nl3\n';
    const current = 'l1\nCHANGED\nl3\n'; // edited line 2
    const proposed = 'l1\nl2\ninserted\nl3\n'; // inserted after line 2
    expect(merge3(base, current, proposed)).toEqual({
      outcome: 'merged',
      content: 'l1\nCHANGED\ninserted\nl3\n',
    });
  });

  it('delete-everything vs edit conflicts', () => {
    const r = merge3('a\nb\n', '', 'a\nB!\n');
    expect(r.outcome).toBe('conflict');
  });

  it('EOF newline is merged as a property (changed side wins)', () => {
    expect(merge3('a\nb\n', 'a\nb', 'a\nB\n')).toEqual({ outcome: 'merged', content: 'a\nB' });
    expect(merge3('a\nb', 'a\nb\n', 'X\nb')).toEqual({ outcome: 'merged', content: 'X\nb\n' });
  });

  it('multiple independent regions all land', () => {
    const base = 's1\n\ns2\n\ns3\n';
    const current = 's1 edited\n\ns2\n\ns3\n';
    const proposed = 's1\n\ns2\n\ns3 edited\n';
    expect(merge3(base, current, proposed)).toEqual({
      outcome: 'merged',
      content: 's1 edited\n\ns2\n\ns3 edited\n',
    });
  });

  it('two conflicting regions report separately, in order', () => {
    const base = 'h\na\nm\nb\n';
    const current = 'h\nA1\nm\nB1\n';
    const proposed = 'h\nA2\nm\nB2\n';
    const r = merge3(base, current, proposed);
    expect(r.outcome).toBe('conflict');
    if (r.outcome === 'conflict') {
      expect(r.regions.map(({ baseStart, baseEnd }) => ({ baseStart, baseEnd }))).toEqual([
        { baseStart: 2, baseEnd: 2 },
        { baseStart: 4, baseEnd: 4 },
      ]);
    }
  });
});
