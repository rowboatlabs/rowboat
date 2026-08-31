import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
    CaptureUpdateAction,
    Excalidraw,
    getSceneVersion,
    reconcileElements,
    restoreElements,
} from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type {
    BinaryFileData,
    BinaryFiles,
    Collaborator,
    ExcalidrawImperativeAPI,
    SocketId,
} from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { RemoteExcalidrawElement } from '@excalidraw/excalidraw/data/reconcile'
import { spaces } from '@x/shared'
import { useTheme } from '@/contexts/theme-context'
import { useSpaceLive, type OrgWithSpaces } from '@/hooks/use-spaces'

// A shared board (Excalidraw), synced Excalidraw's own way on top of the
// spaces live channel: per-element last-writer-wins. Every element carries
// {version, versionNonce}; edits broadcast only the elements whose version
// advanced; receivers run reconcileElements (higher version wins, local
// in-progress edits protected) and apply with captureUpdate NEVER so remote
// strokes stay out of local undo. A full-scene rebroadcast every 20s and the
// snapshot reconciliation heal any dropped frame — ephemeral loss costs
// smoothness, never data.
//
// Durability is the normal asset path: the scene serializes to a standard
// .excalidraw JSON blob (images embedded as dataURLs, so the file stands
// alone for agents and exports) proposed against the board's asset version.
// Stale binary proposes always conflict (contract), so on conflict we pull
// the winner, reconcile, and re-propose — excalidraw.com's merge-on-save
// transaction expressed in the propose contract. Only the editor saves
// (dirty flag), so idle viewers never write.
//
// Live image bytes never ride the socket: new files upload as space blobs
// and a {t:'files'} frame maps fileId → hash; peers fetch via the
// authenticated app://space-blob protocol.

declare global {
    interface Window {
        EXCALIDRAW_ASSET_PATH?: string | string[]
    }
}
// Self-hosted fonts (vite.config.ts copies/serves them) — without this the
// editor falls back to a CDN, which a desktop app can't rely on offline.
window.EXCALIDRAW_ASSET_PATH = './excalidraw-assets/'

const CURSOR_SYNC_MS = 33 // ~30fps, Excalidraw's own cadence
const FULL_SYNC_MS = 20_000 // periodic full-scene self-heal
const SAVE_AFTER_MS = 15_000 // snapshot throttle once the board exists
const FIRST_SAVE_AFTER_MS = 1_500 // a new board becomes an asset on the first stroke
const HEARTBEAT_MS = 20_000
const COLLABORATOR_TTL_MS = 65_000 // ~3 missed heartbeats

type LoadState =
    | { phase: 'loading' }
    | { phase: 'ready'; elements: OrderedExcalidrawElement[]; files: BinaryFiles }
    | { phase: 'error'; message: string }

interface SnapshotJson {
    elements?: unknown[]
    files?: BinaryFiles
}

function blobUrl(orgId: string, spaceId: string, hash: string): string {
    return `app://space-blob/${encodeURIComponent(orgId)}/${encodeURIComponent(spaceId)}/${hash}`
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
}

function parseSnapshot(raw: string): SnapshotJson | null {
    try {
        const data = JSON.parse(raw) as SnapshotJson
        return data && Array.isArray(data.elements) ? data : null
    } catch {
        return null
    }
}

export default function WhiteboardPane({ org, space, boardId, memberNames, active }: {
    org: OrgWithSpaces
    space: spaces.Space
    /** The board's asset path (whiteboards/<name>.excalidraw). */
    boardId: string
    memberNames: ReadonlyMap<string, string>
    /** False while the pane is on screen but the app shows another section. */
    active: boolean
}) {
    const { resolvedTheme } = useTheme()
    const [load, setLoad] = useState<LoadState>({ phase: 'loading' })
    const [retryTick, setRetryTick] = useState(0)

    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
    /** Per-pane identity: the relay echoes our own frames back; this is how we drop them. */
    const clientIdRef = useRef<string>(crypto.randomUUID())
    /** elementId → last version we broadcast (diff gate, Excalidraw's broadcastedElementVersions). */
    const broadcastVersionsRef = useRef(new Map<string, number>())
    /** Excalidraw's lastBroadcastedOrReceivedSceneVersion — gates onChange re-broadcasts. */
    const lastSceneVersionRef = useRef(0)
    /** The asset version our next propose declares as base. */
    const baseVersionRef = useRef(0)
    const dirtyRef = useRef(false)
    const savingRef = useRef(false)
    const cursorSentAtRef = useRef(0)
    const fullSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /** fileId → space-blob mapping we know (uploaded ourselves or learned from peers). */
    const knownFilesRef = useRef(new Map<string, { hash: string; mime: string }>())
    const uploadingFilesRef = useRef(new Set<string>())
    const collaboratorsRef = useRef(new Map<string, { collab: Collaborator; lastSeen: number }>())
    /** Blocks onChange broadcasts until the initial scene is seeded into the version gates. */
    const savingGateRef = useRef<'loading' | 'ready'>('loading')
    const activeRef = useRef(active)
    activeRef.current = active
    const memberNamesRef = useRef(memberNames)
    memberNamesRef.current = memberNames

    const send = (payload: spaces.SpacesWhiteboardPayload) => {
        void window.ipc
            .invoke('spaces:whiteboard', { orgId: org.id, spaceId: space.id, boardId, payload })
            .catch(() => {}) // fire-and-forget like presence; full sync heals
    }

    // ------------------------------------------------------------------
    // Load: the latest snapshot, or an empty scene for a board that does
    // not exist yet (it becomes an asset on the first save).
    // ------------------------------------------------------------------
    useEffect(() => {
        let cancelled = false
        setLoad({ phase: 'loading' })
        void (async () => {
            try {
                const res = await window.ipc.invoke('spaces:readAsset', { orgId: org.id, spaceId: space.id, path: boardId })
                if (cancelled) return
                let snapshot: SnapshotJson | null = null
                if (res.blob) {
                    const resp = await fetch(blobUrl(org.id, space.id, res.blob.hash))
                    if (!resp.ok) throw new Error('could not fetch the board snapshot')
                    snapshot = parseSnapshot(await resp.text())
                } else if (res.content.trim()) {
                    snapshot = parseSnapshot(res.content)
                }
                if (cancelled) return
                baseVersionRef.current = res.version
                const elements = snapshot
                    ? (restoreElements(snapshot.elements as Parameters<typeof restoreElements>[0], null) as unknown as OrderedExcalidrawElement[])
                    : []
                setLoad({ phase: 'ready', elements, files: snapshot?.files ?? {} })
            } catch (err) {
                if (cancelled) return
                const message = err instanceof Error ? err.message : String(err)
                if (/not.?found|no such/i.test(message)) {
                    // A board that hasn't been drawn on yet.
                    baseVersionRef.current = 0
                    setLoad({ phase: 'ready', elements: [], files: {} })
                } else {
                    setLoad({ phase: 'error', message })
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [org.id, space.id, boardId, retryTick])

    // ------------------------------------------------------------------
    // Outbound: diff broadcasts from onChange, the periodic full sync,
    // cursors from onPointerUpdate, snapshot saves.
    // ------------------------------------------------------------------
    const broadcastAll = () => {
        const api = apiRef.current
        if (!api) return
        const elements = api.getSceneElementsIncludingDeleted()
        for (const el of elements) broadcastVersionsRef.current.set(el.id, el.version)
        send({ t: 'scene', clientId: clientIdRef.current, syncAll: true, elements: elements as unknown[] })
        if (knownFilesRef.current.size > 0) {
            send({ t: 'files', clientId: clientIdRef.current, entries: Object.fromEntries(knownFilesRef.current) })
        }
    }

    const scheduleFullSync = () => {
        if (fullSyncTimerRef.current) return
        fullSyncTimerRef.current = setTimeout(() => {
            fullSyncTimerRef.current = null
            broadcastAll()
        }, FULL_SYNC_MS)
    }

    const scheduleSave = () => {
        if (saveTimerRef.current) return
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            void saveSnapshot()
        }, baseVersionRef.current === 0 ? FIRST_SAVE_AFTER_MS : SAVE_AFTER_MS)
    }

    /**
     * Text assets cap at 1MB (contract). Snapshots below this store as TEXT so
     * agents read and draw through the plain read_asset/propose_change MCP
     * tools; bigger boards (embedded images) fall back to a blob version.
     * The JSON is one line on purpose: Harbor's line-merge can then never
     * produce a mangled "merged" body — non-identical concurrent saves always
     * conflict (fixture 02), which the reconcile-and-retry below handles.
     */
    const TEXT_SNAPSHOT_MAX_BYTES = 900_000

    const saveSnapshot = async () => {
        const api = apiRef.current
        if (!api || !dirtyRef.current || savingRef.current) return
        savingRef.current = true
        try {
            const elements = api.getSceneElementsIncludingDeleted()
            const savedSceneVersion = getSceneVersion(elements)
            // Standard .excalidraw JSON, images embedded — the asset stands on
            // its own for agents, exports, and cold loads.
            const json = JSON.stringify({
                type: 'excalidraw',
                version: 2,
                source: 'rowboat',
                elements,
                appState: {},
                files: api.getFiles(),
            })
            const encoded = new TextEncoder().encode(json)
            let input: spaces.SpacesProposeInput
            if (encoded.length <= TEXT_SNAPSHOT_MAX_BYTES) {
                input = { assetPath: boardId, baseVersion: baseVersionRef.current, newContent: json, reason: 'whiteboard' }
            } else {
                const name = boardId.slice(boardId.lastIndexOf('/') + 1)
                const uploaded = await window.ipc.invoke('spaces:uploadBlob', {
                    orgId: org.id, spaceId: space.id, bytes: bytesToBase64(encoded), name, mime: 'application/json',
                })
                input = { assetPath: boardId, baseVersion: baseVersionRef.current, blob: uploaded.blob.hash, reason: 'whiteboard' }
            }
            const result = await window.ipc.invoke('spaces:proposeChange', { orgId: org.id, spaceId: space.id, input })
            if (result.outcome === 'conflict') {
                // Someone saved meanwhile. Pull the winner, reconcile it into
                // the live scene, and re-propose the merge against their base.
                baseVersionRef.current = result.currentVersion
                await pullSnapshot()
                scheduleSave()
            } else if (result.outcome === 'merged' && result.mergedContent !== json) {
                // Only identical proposals merge for one-line JSON; anything
                // else stored something we didn't write — reconcile and resave.
                baseVersionRef.current = result.version
                await pullSnapshot()
                scheduleSave()
            } else {
                baseVersionRef.current = result.version
                if (getSceneVersion(api.getSceneElementsIncludingDeleted()) === savedSceneVersion) dirtyRef.current = false
                else scheduleSave() // kept drawing while the save was in flight
            }
        } catch {
            scheduleSave() // org unreachable — retry on the normal cadence
        } finally {
            savingRef.current = false
        }
    }

    /** Fetch the stored snapshot and reconcile it into the open scene (conflict / change-event heal, agent writes included). */
    const pullSnapshot = async () => {
        const api = apiRef.current
        if (!api) return
        try {
            const res = await window.ipc.invoke('spaces:readAsset', { orgId: org.id, spaceId: space.id, path: boardId })
            baseVersionRef.current = Math.max(baseVersionRef.current, res.version)
            let snapshot: SnapshotJson | null = null
            if (res.blob) {
                const resp = await fetch(blobUrl(org.id, space.id, res.blob.hash))
                if (resp.ok) snapshot = parseSnapshot(await resp.text())
            } else if (res.content.trim()) {
                snapshot = parseSnapshot(res.content)
            }
            if (!snapshot) return
            applyRemoteElements(snapshot.elements ?? [])
            if (snapshot.files && Object.keys(snapshot.files).length > 0) {
                api.addFiles(Object.values(snapshot.files))
            }
        } catch {
            // unreachable org — the live channel keeps working; snapshots catch up later
        }
    }

    const onChange = () => {
        const api = apiRef.current
        if (!api || savingGateRef.current !== 'ready') return
        const elements = api.getSceneElementsIncludingDeleted()
        const sceneVersion = getSceneVersion(elements)
        if (sceneVersion <= lastSceneVersionRef.current) return
        lastSceneVersionRef.current = sceneVersion
        dirtyRef.current = true
        const changed = elements.filter((el) => (broadcastVersionsRef.current.get(el.id) ?? -1) < el.version)
        if (changed.length > 0) {
            for (const el of changed) broadcastVersionsRef.current.set(el.id, el.version)
            send({ t: 'scene', clientId: clientIdRef.current, syncAll: false, elements: changed as unknown[] })
        }
        scheduleFullSync()
        scheduleSave()
        void syncNewFiles()
    }

    /** Upload files the editor holds that no blob backs yet, then announce the mapping. */
    const syncNewFiles = async () => {
        const api = apiRef.current
        if (!api) return
        const files = api.getFiles()
        const announced: Record<string, { hash: string; mime: string }> = {}
        for (const [fileId, file] of Object.entries(files)) {
            if (knownFilesRef.current.has(fileId) || uploadingFilesRef.current.has(fileId)) continue
            uploadingFilesRef.current.add(fileId)
            try {
                const comma = file.dataURL.indexOf(',')
                if (comma < 0) continue
                const uploaded = await window.ipc.invoke('spaces:uploadBlob', {
                    orgId: org.id,
                    spaceId: space.id,
                    bytes: file.dataURL.slice(comma + 1),
                    name: fileId,
                    mime: file.mimeType,
                })
                const entry = { hash: uploaded.blob.hash, mime: file.mimeType }
                knownFilesRef.current.set(fileId, entry)
                announced[fileId] = entry
            } catch {
                // retried on the next onChange pass
            } finally {
                uploadingFilesRef.current.delete(fileId)
            }
        }
        if (Object.keys(announced).length > 0) {
            send({ t: 'files', clientId: clientIdRef.current, entries: announced })
        }
    }

    const onPointerUpdate = (payload: {
        pointer: { x: number; y: number; tool: 'pointer' | 'laser' }
        button: 'down' | 'up'
        pointersMap: Map<number, unknown>
    }) => {
        if (!activeRef.current || payload.pointersMap.size > 1) return
        const now = Date.now()
        if (now - cursorSentAtRef.current < CURSOR_SYNC_MS) return
        cursorSentAtRef.current = now
        send({
            t: 'cursor',
            clientId: clientIdRef.current,
            cursor: {
                x: payload.pointer.x,
                y: payload.pointer.y,
                tool: payload.pointer.tool,
                button: payload.button,
                selectedElementIds: (apiRef.current?.getAppState().selectedElementIds ?? {}) as Record<string, boolean>,
            },
        })
    }

    // ------------------------------------------------------------------
    // Inbound: whiteboard frames from peers, plus durable change events
    // for this asset (another client's save, or an agent drawing through
    // the MCP face — both reconcile into the open scene).
    // ------------------------------------------------------------------
    const applyRemoteElements = (raw: unknown[]) => {
        const api = apiRef.current
        if (!api || raw.length === 0) return
        const restored = restoreElements(raw as Parameters<typeof restoreElements>[0], null) as unknown as RemoteExcalidrawElement[]
        const reconciled = reconcileElements(api.getSceneElementsIncludingDeleted(), restored, api.getAppState())
        lastSceneVersionRef.current = getSceneVersion(reconciled)
        api.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER })
        void fetchMissingFiles()
    }

    /** Pull blob bytes for image elements whose file we don't hold yet. */
    const fetchMissingFiles = async () => {
        const api = apiRef.current
        if (!api) return
        const have = api.getFiles()
        const toAdd: BinaryFileData[] = []
        for (const el of api.getSceneElementsIncludingDeleted()) {
            const fileId = el.type === 'image' ? (el as { fileId?: string | null }).fileId : null
            if (!fileId || have[fileId as keyof typeof have]) continue
            const known = knownFilesRef.current.get(fileId)
            if (!known) continue // the mapping frame or a snapshot will bring it
            try {
                const resp = await fetch(blobUrl(org.id, space.id, known.hash))
                if (!resp.ok) continue
                const b64 = bytesToBase64(new Uint8Array(await resp.arrayBuffer()))
                toAdd.push({
                    id: fileId,
                    dataURL: `data:${known.mime};base64,${b64}`,
                    mimeType: known.mime,
                    created: Date.now(),
                } as BinaryFileData)
            } catch {
                // next files/scene frame retries
            }
        }
        if (toAdd.length > 0) api.addFiles(toAdd)
    }

    const pushCollaborators = () => {
        const map = new Map<SocketId, Collaborator>()
        for (const [cid, entry] of collaboratorsRef.current) map.set(cid as SocketId, entry.collab)
        apiRef.current?.updateScene({ collaborators: map })
    }

    /** Any frame from a peer proves the pane is open — keep their entry alive. */
    const touchCollaborator = (clientId: string, memberId: string): Collaborator => {
        const existing = collaboratorsRef.current.get(clientId)
        const collab: Collaborator = existing?.collab ?? {
            id: memberId,
            socketId: clientId as SocketId,
            username: memberNamesRef.current.get(memberId) ?? memberId,
        }
        collaboratorsRef.current.set(clientId, { collab, lastSeen: Date.now() })
        return collab
    }

    const handlePayload = (memberId: string, payload: spaces.SpacesWhiteboardPayload) => {
        switch (payload.t) {
            case 'scene': {
                touchCollaborator(payload.clientId, memberId)
                pushCollaborators()
                applyRemoteElements(payload.elements)
                break
            }
            case 'scene_request': {
                touchCollaborator(payload.clientId, memberId)
                pushCollaborators()
                broadcastAll()
                break
            }
            case 'files': {
                for (const [fileId, entry] of Object.entries(payload.entries)) {
                    knownFilesRef.current.set(fileId, entry)
                }
                void fetchMissingFiles()
                break
            }
            case 'cursor': {
                const prev = touchCollaborator(payload.clientId, memberId)
                collaboratorsRef.current.set(payload.clientId, {
                    lastSeen: Date.now(),
                    collab: {
                        ...prev,
                        username: memberNamesRef.current.get(memberId) ?? memberId,
                        pointer: { x: payload.cursor.x, y: payload.cursor.y, tool: payload.cursor.tool },
                        button: payload.cursor.button,
                        selectedElementIds: payload.cursor.selectedElementIds as Collaborator['selectedElementIds'],
                    },
                })
                pushCollaborators()
                break
            }
            case 'idle': {
                if (payload.state === 'away') {
                    collaboratorsRef.current.delete(payload.clientId)
                } else {
                    const prev = touchCollaborator(payload.clientId, memberId)
                    collaboratorsRef.current.set(payload.clientId, {
                        lastSeen: Date.now(),
                        collab: { ...prev, userState: payload.state === 'idle' ? ('idle' as Collaborator['userState']) : ('active' as Collaborator['userState']) },
                    })
                }
                pushCollaborators()
                break
            }
        }
    }

    useSpaceLive(org.id, space.id, (frame) => {
        if (frame.kind === 'whiteboard') {
            if (frame.boardId !== boardId) return
            const payload = frame.payload as spaces.SpacesWhiteboardPayload | undefined
            if (!payload || typeof payload !== 'object' || payload.clientId === clientIdRef.current) return
            handlePayload(frame.memberId, payload)
        } else if (frame.kind === 'event' && frame.event.type === 'change') {
            const cs = frame.event.changeSet
            if (cs.assetPath !== boardId || cs.op || cs.resultVersion <= baseVersionRef.current) return
            // A snapshot we didn't write (another client, another window, or an
            // agent via the MCP face) — pull and reconcile it into the scene.
            void pullSnapshot()
        }
    })

    // ------------------------------------------------------------------
    // Session lifecycle: join once the scene is up, heartbeat + sweep
    // while open, leave (and flush the last edits) on the way out.
    // ------------------------------------------------------------------
    const onApiReady = (api: ExcalidrawImperativeAPI) => {
        apiRef.current = api
        lastSceneVersionRef.current = getSceneVersion(api.getSceneElementsIncludingDeleted())
        for (const el of api.getSceneElementsIncludingDeleted()) {
            broadcastVersionsRef.current.set(el.id, el.version)
        }
        savingGateRef.current = 'ready'
        // Ask whoever is already drawing for the scene state newer than our snapshot.
        send({ t: 'scene_request', clientId: clientIdRef.current })
        send({ t: 'idle', clientId: clientIdRef.current, state: activeRef.current ? 'active' : 'idle' })
    }

    useEffect(() => {
        if (load.phase !== 'ready') return
        let tick = 0
        const timer = setInterval(() => {
            tick += 1
            // TTL sweep: drop collaborators whose heartbeats stopped (closed pane, dead app).
            const now = Date.now()
            let changed = false
            for (const [cid, entry] of collaboratorsRef.current) {
                if (now - entry.lastSeen > COLLABORATOR_TTL_MS) {
                    collaboratorsRef.current.delete(cid)
                    changed = true
                }
            }
            if (changed) pushCollaborators()
            if (tick % Math.max(1, Math.round(HEARTBEAT_MS / 10_000)) === 0) {
                send({ t: 'idle', clientId: clientIdRef.current, state: activeRef.current ? 'active' : 'idle' })
            }
        }, 10_000)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load.phase])

    useEffect(() => {
        return () => {
            // Leaving the board: tell peers, and flush edits the save timer
            // hadn't gotten to (best effort — peers hold the scene live, and
            // their saves persist it even if this one loses the race).
            if (fullSyncTimerRef.current) clearTimeout(fullSyncTimerRef.current)
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            send({ t: 'idle', clientId: clientIdRef.current, state: 'away' })
            if (dirtyRef.current) void saveSnapshot()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ------------------------------------------------------------------

    if (load.phase === 'loading') {
        return (
            <div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Opening board…
            </div>
        )
    }

    if (load.phase === 'error') {
        return (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
                <div className="max-w-xs text-sm text-muted-foreground">
                    <p>Could not open this board: {load.message}</p>
                    <button
                        type="button"
                        onClick={() => setRetryTick((t) => t + 1)}
                        className="mt-3 rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
                    >
                        Try again
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 min-w-0 min-h-0">
            <Excalidraw
                excalidrawAPI={onApiReady}
                initialData={{ elements: load.elements, files: load.files, scrollToContent: true }}
                onChange={onChange}
                onPointerUpdate={onPointerUpdate}
                theme={resolvedTheme}
                isCollaborating
                autoFocus
            />
        </div>
    )
}
