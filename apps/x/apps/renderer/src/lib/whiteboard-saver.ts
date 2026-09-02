/**
 * Snapshot persistence for a whiteboard pane, extracted from the pane so the
 * dangerous part — WHEN a board may be written — is a pure state machine with
 * tests, instead of timing folklore spread across React effects.
 *
 * The invariants this module owes the pane (each one closed a real wipe path;
 * see the regression tests before relaxing any of them):
 *
 * 1. A saver is created only from a loaded snapshot, so a save cannot exist
 *    before hydration — there is no "empty initial state" to persist.
 * 2. Saves serialize `latest`, the last scene this saver accepted — never a
 *    live read of the Excalidraw API. Excalidraw swaps in a fresh EMPTY scene
 *    in componentWillUnmount, and the pane's unmount flush runs after that
 *    (passive cleanup vs. class unmount), so an API read at save time returns
 *    [] and would overwrite the board with nothing.
 * 3. A local change is accepted only when its scene version advances past the
 *    last accepted one. Hydration echoes the loaded version (restore keeps
 *    element versions) and pre-hydration onChange fires with an empty scene at
 *    version 0 — both are swallowed. A user clearing the board is NOT: clear
 *    marks every element isDeleted via newElementWith, which bumps versions,
 *    so an intentional wipe still advances and still saves.
 * 4. dispose() cancels the pending timer and blocks every continuation of an
 *    in-flight save (conflict retries included), so a dead pane or a switched
 *    board can never write again. flush() before dispose() is the one
 *    legitimate parting shot, and it too serializes `latest`.
 */

/** The slice of ProposeChangeResult the saver acts on (structurally satisfied by the protocol type). */
export type SnapshotProposeResult =
    | { outcome: 'applied'; version: number }
    | { outcome: 'merged'; version: number; mergedContent: string }
    | { outcome: 'conflict'; currentVersion: number }

export interface BoardSaverIO {
    /** Persist one serialized snapshot against a base version (the pane picks text vs. blob transport). */
    propose(json: string, baseVersion: number): Promise<SnapshotProposeResult>
    /**
     * A concurrent writer won — fetch the stored snapshot and reconcile it
     * into the open scene (the pane routes the result back through
     * onRemoteApplied). The saver re-proposes the merge afterwards.
     */
    pullAndReconcile(): Promise<void>
}

export interface BoardSaverInit {
    /** The loaded asset version the first propose declares as base (0 = board not created yet). */
    baseVersion: number
    /** The loaded elements — what `latest` starts as. */
    elements: readonly unknown[]
    /** getSceneVersion(elements) — the hydration fingerprint local changes must advance past. */
    sceneVersion: number
    /** A board becomes an asset on the first stroke, so the first save is quick. */
    firstSaveDelayMs: number
    saveDelayMs: number
    io: BoardSaverIO
}

export interface BoardSaver {
    /** The asset version the next propose declares as base (the pane's staleness check for change events). */
    readonly baseVersion: number
    /**
     * An onChange from the editor. Accepted (and scheduled for save) only when
     * sceneVersion advances past the last accepted scene; returns whether it
     * was, which also gates the pane's live broadcast.
     */
    onLocalChange(elements: readonly unknown[], sceneVersion: number): boolean
    /** A reconciled remote scene was applied to the editor: adopt it without marking dirty. */
    onRemoteApplied(elements: readonly unknown[], sceneVersion: number): void
    /** A pull observed the stored asset at `version` — future proposes must base there. */
    noteRemoteVersion(version: number): void
    /** Save now if dirty (the pane's parting flush). Skips when a save is already in flight. */
    flush(): void
    /** Cancel the pending save and block in-flight continuations. Terminal. */
    dispose(): void
}

export function createBoardSaver(init: BoardSaverInit): BoardSaver {
    const { io, firstSaveDelayMs, saveDelayMs } = init
    let baseVersion = init.baseVersion
    let latest = init.elements
    let lastSceneVersion = init.sceneVersion
    let dirty = false
    let saving = false
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const cancelTimer = () => {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
    }

    const schedule = () => {
        if (disposed || timer !== null) return
        timer = setTimeout(() => {
            timer = null
            void save()
        }, baseVersion === 0 ? firstSaveDelayMs : saveDelayMs)
    }

    const save = async () => {
        if (disposed || !dirty || saving) return
        saving = true
        try {
            const savedSceneVersion = lastSceneVersion
            // Standard .excalidraw JSON; `files` is always empty because the
            // image tool is disabled — boards are shapes + text only. One line
            // on purpose: Harbor's line-merge can then never produce a mangled
            // "merged" body — non-identical concurrent saves always conflict
            // (fixture 02), which the reconcile-and-retry below handles.
            const json = JSON.stringify({
                type: 'excalidraw',
                version: 2,
                source: 'rowboat',
                elements: latest,
                appState: {},
                files: {},
            })
            const result = await io.propose(json, baseVersion)
            if (disposed) return
            if (result.outcome === 'conflict') {
                // Someone saved meanwhile. Pull the winner, reconcile it into
                // the live scene, and re-propose the merge against their base.
                baseVersion = result.currentVersion
                await io.pullAndReconcile()
                if (disposed) return
                schedule()
            } else if (result.outcome === 'merged' && result.mergedContent !== json) {
                // Only identical proposals merge for one-line JSON; anything
                // else stored something we didn't write — reconcile and resave.
                baseVersion = result.version
                await io.pullAndReconcile()
                if (disposed) return
                schedule()
            } else {
                baseVersion = result.version
                if (lastSceneVersion === savedSceneVersion) dirty = false
                else schedule() // kept drawing while the save was in flight
            }
        } catch {
            if (!disposed) schedule() // org unreachable — retry on the normal cadence
        } finally {
            saving = false
        }
    }

    return {
        get baseVersion() {
            return baseVersion
        },
        onLocalChange(elements, sceneVersion) {
            if (disposed || sceneVersion <= lastSceneVersion) return false
            latest = elements
            lastSceneVersion = sceneVersion
            dirty = true
            schedule()
            return true
        },
        onRemoteApplied(elements, sceneVersion) {
            if (disposed) return
            latest = elements
            lastSceneVersion = Math.max(lastSceneVersion, sceneVersion)
        },
        noteRemoteVersion(version) {
            baseVersion = Math.max(baseVersion, version)
        },
        flush() {
            cancelTimer()
            // In-flight save: its completion path reschedules if the scene
            // moved on, and dispose() right after decides whether that lands.
            if (disposed || !dirty || saving) return
            void save()
        },
        dispose() {
            disposed = true
            cancelTimer()
        },
    }
}
