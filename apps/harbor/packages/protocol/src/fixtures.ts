import { z } from 'zod';

// Golden merge fixtures (fixtures/merge/*.json). A conforming merge engine —
// stub or real — MUST produce exactly these outcomes. The engine is line-level
// three-way merge: base = the proposal's declared base version's content,
// current = the asset now (the earlier writer's result), proposed = the stale
// proposal's newContent. Outcome semantics match ProposeChangeResult.

export const MergeFixtureExpectation = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('merged'),
    /** Exact content the engine must produce and store. */
    content: z.string(),
  }),
  z.object({
    outcome: z.literal('conflict'),
    /** 1-based inclusive line ranges of the BASE that collide. Order matters. */
    regions: z.array(
      z.object({
        baseStart: z.number().int().positive(),
        baseEnd: z.number().int().nonnegative(),
      }),
    ),
  }),
]);

export const MergeFixture = z.object({
  name: z.string(),
  description: z.string(),
  base: z.string(),
  /** Content as it exists now — the earlier, already-applied change-set's result. */
  current: z.string(),
  /** The stale proposal's full newContent (declared against `base`). */
  proposed: z.string(),
  expected: MergeFixtureExpectation,
});
export type MergeFixture = z.infer<typeof MergeFixture>;
