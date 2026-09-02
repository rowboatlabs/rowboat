import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoardSaver, type BoardSaverIO, type SnapshotProposeResult } from './whiteboard-saver'

// The wipe this module exists to prevent (asset_versions of a real board):
// v3..v9 held drawings, v10 was {"elements":[]} — the pane saved a scene it
// read from Excalidraw at the wrong moment (pre-hydration, or post-unmount
// when Excalidraw swaps in a fresh empty scene). These tests pin the saver's
// invariants; the pane wiring relies on every one of them.

const FIRST_SAVE_MS = 1_500
const SAVE_MS = 15_000

/** Two drawn elements, the way a loaded snapshot looks. getSceneVersion sums versions → 40. */
const DRAWN = [
    { id: 'a', version: 20, isDeleted: false },
    { id: 'b', version: 20, isDeleted: false },
]
/** DRAWN after one more stroke on `b`. */
const EDITED = [
    { id: 'a', version: 20, isDeleted: false },
    { id: 'b', version: 21, isDeleted: false },
]
/**
 * DRAWN after "clear canvas": Excalidraw marks every element isDeleted via
 * newElementWith, which BUMPS versions — a wipe the user asked for advances
 * the scene version, unlike the empty scenes the saver must reject.
 */
const CLEARED = [
    { id: 'a', version: 21, isDeleted: true },
    { id: 'b', version: 21, isDeleted: true },
]

function sceneVersion(elements: Array<{ version: number }>): number {
    return elements.reduce((sum, el) => sum + el.version, 0)
}

function elementsOf(json: string): unknown[] {
    return (JSON.parse(json) as { elements: unknown[] }).elements
}

function harness({ baseVersion = 3, elements = DRAWN as readonly unknown[], scene = sceneVersion(DRAWN) } = {}) {
    const proposes: Array<{ json: string; baseVersion: number }> = []
    let respond: (json: string, baseVersion: number) => Promise<SnapshotProposeResult> = async (_json, base) => ({
        outcome: 'applied',
        version: base + 1,
    })
    const io: BoardSaverIO = {
        propose: vi.fn(async (json: string, base: number) => {
            proposes.push({ json, baseVersion: base })
            return respond(json, base)
        }),
        pullAndReconcile: vi.fn(async () => {}),
    }
    const saver = createBoardSaver({
        baseVersion,
        elements,
        sceneVersion: scene,
        firstSaveDelayMs: FIRST_SAVE_MS,
        saveDelayMs: SAVE_MS,
        io,
    })
    return { saver, io, proposes, setRespond: (fn: typeof respond) => (respond = fn) }
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('createBoardSaver', () => {
    it('never saves the initial state of an existing board (hydration echo, pre-hydration empty scene)', async () => {
        const { saver, io } = harness()
        // Pre-hydration: Excalidraw's constructor scene is empty (version 0).
        expect(saver.onLocalChange([], 0)).toBe(false)
        // Hydration echo: initialData lands and onChange reports the loaded scene.
        expect(saver.onLocalChange(DRAWN, sceneVersion(DRAWN))).toBe(false)
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        saver.flush()
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        expect(io.propose).not.toHaveBeenCalled()
    })

    it('saves an edit after hydration, on the normal cadence, against the loaded base', async () => {
        const { saver, io, proposes } = harness()
        expect(saver.onLocalChange(EDITED, sceneVersion(EDITED))).toBe(true)
        await vi.advanceTimersByTimeAsync(SAVE_MS - 1)
        expect(io.propose).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(proposes).toHaveLength(1)
        expect(proposes[0].baseVersion).toBe(3)
        expect(elementsOf(proposes[0].json)).toEqual(EDITED)
        expect(saver.baseVersion).toBe(4)
        // Clean now — nothing left to save.
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        expect(io.propose).toHaveBeenCalledTimes(1)
    })

    it('saves an intentional clear (isDeleted marks advance the scene version)', async () => {
        const { saver, proposes } = harness()
        expect(saver.onLocalChange(CLEARED, sceneVersion(CLEARED))).toBe(true)
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(1)
        expect(elementsOf(proposes[0].json)).toEqual(CLEARED)
    })

    it('flush saves the last ACCEPTED scene — not whatever the editor answers at unmount', async () => {
        const { saver, proposes } = harness()
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        // At unmount Excalidraw's API would answer [] (fresh scene). The saver
        // never re-reads the editor, so the flush carries the real elements.
        saver.flush()
        saver.dispose()
        await vi.advanceTimersByTimeAsync(0)
        expect(proposes).toHaveLength(1)
        expect(elementsOf(proposes[0].json)).toEqual(EDITED)
    })

    it('flush without edits writes nothing (open + close does not touch the asset)', async () => {
        const { saver, io } = harness()
        saver.onLocalChange(DRAWN, sceneVersion(DRAWN)) // hydration echo only
        saver.flush()
        saver.dispose()
        await vi.advanceTimersByTimeAsync(0)
        expect(io.propose).not.toHaveBeenCalled()
    })

    it('dispose cancels a pending save', async () => {
        const { saver, io } = harness()
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        saver.dispose()
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        expect(io.propose).not.toHaveBeenCalled()
        // And nothing accepted after death.
        expect(saver.onLocalChange(CLEARED, sceneVersion(CLEARED))).toBe(false)
    })

    it('dispose blocks the continuation of an in-flight save (no pull, no retry)', async () => {
        const { saver, io, setRespond } = harness()
        let resolvePropose!: (r: SnapshotProposeResult) => void
        setRespond(() => new Promise((resolve) => (resolvePropose = resolve)))
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(io.propose).toHaveBeenCalledTimes(1)
        saver.dispose()
        resolvePropose({ outcome: 'conflict', currentVersion: 9 })
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        expect(io.pullAndReconcile).not.toHaveBeenCalled()
        expect(io.propose).toHaveBeenCalledTimes(1)
    })

    it('a conflict pulls the winner, rebases, and re-proposes the merge', async () => {
        const { saver, io, proposes, setRespond } = harness()
        const merged = [...EDITED, { id: 'c', version: 2, isDeleted: false }]
        setRespond(async () => ({ outcome: 'conflict', currentVersion: 9 }))
        vi.mocked(io.pullAndReconcile).mockImplementation(async () => {
            // The pane pulls the stored snapshot and reconciles it into the
            // scene, which lands here as a remote apply.
            saver.onRemoteApplied(merged, sceneVersion(merged))
        })
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(io.pullAndReconcile).toHaveBeenCalledTimes(1)
        setRespond(async (_json, base) => ({ outcome: 'applied', version: base + 1 }))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(2)
        expect(proposes[1].baseVersion).toBe(9)
        expect(elementsOf(proposes[1].json)).toEqual(merged)
        expect(saver.baseVersion).toBe(10)
    })

    it('a merged result with foreign content pulls and resaves; identical content is a clean save', async () => {
        const { saver, io, setRespond, proposes } = harness()
        setRespond(async (json) => ({ outcome: 'merged', version: 5, mergedContent: json }))
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(io.pullAndReconcile).not.toHaveBeenCalled()
        expect(saver.baseVersion).toBe(5)

        setRespond(async () => ({ outcome: 'merged', version: 6, mergedContent: 'something else entirely' }))
        saver.onLocalChange(CLEARED, sceneVersion(CLEARED))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(io.pullAndReconcile).toHaveBeenCalledTimes(1)
        setRespond(async (_json, base) => ({ outcome: 'applied', version: base + 1 }))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(3)
        expect(proposes[2].baseVersion).toBe(6)
    })

    it('a brand-new board saves its first stroke quickly', async () => {
        const stroke = [{ id: 'a', version: 3, isDeleted: false }]
        const { saver, proposes } = harness({ baseVersion: 0, elements: [], scene: 0 })
        expect(saver.onLocalChange(stroke, sceneVersion(stroke))).toBe(true)
        await vi.advanceTimersByTimeAsync(FIRST_SAVE_MS)
        expect(proposes).toHaveLength(1)
        expect(proposes[0].baseVersion).toBe(0)
        expect(elementsOf(proposes[0].json)).toEqual(stroke)
    })

    it('remote applies never mark the board dirty (idle viewers never write)', async () => {
        const { saver, io } = harness()
        const remote = [...DRAWN, { id: 'peer', version: 4, isDeleted: false }]
        saver.onRemoteApplied(remote, sceneVersion(remote))
        // The onChange that updateScene fires reports the same version — swallowed.
        expect(saver.onLocalChange(remote, sceneVersion(remote))).toBe(false)
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        saver.flush()
        await vi.advanceTimersByTimeAsync(SAVE_MS * 4)
        expect(io.propose).not.toHaveBeenCalled()
    })

    it('edits made while a save is in flight get their own save', async () => {
        const { saver, proposes, setRespond } = harness()
        let resolvePropose!: (r: SnapshotProposeResult) => void
        setRespond(() => new Promise((resolve) => (resolvePropose = resolve)))
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(1)
        saver.onLocalChange(CLEARED, sceneVersion(CLEARED)) // kept drawing mid-save
        setRespond(async (_json, base) => ({ outcome: 'applied', version: base + 1 }))
        resolvePropose({ outcome: 'applied', version: 4 })
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(2)
        expect(elementsOf(proposes[1].json)).toEqual(CLEARED)
    })

    it('a failed propose retries on the normal cadence', async () => {
        const { saver, proposes, setRespond } = harness()
        setRespond(async () => {
            throw new Error('org unreachable')
        })
        saver.onLocalChange(EDITED, sceneVersion(EDITED))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(1)
        setRespond(async (_json, base) => ({ outcome: 'applied', version: base + 1 }))
        await vi.advanceTimersByTimeAsync(SAVE_MS)
        expect(proposes).toHaveLength(2)
        expect(elementsOf(proposes[1].json)).toEqual(EDITED)
    })

    it('noteRemoteVersion never regresses the base', () => {
        const { saver } = harness({ baseVersion: 7 })
        saver.noteRemoteVersion(2)
        expect(saver.baseVersion).toBe(7)
        saver.noteRemoteVersion(11)
        expect(saver.baseVersion).toBe(11)
    })
})
