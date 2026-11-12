import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Loader2, Maximize2, Minus, Network, Plus, RefreshCw } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { SpacesEmpty } from '@/components/spaces/page-shell'
import { invokeSpace } from '@/lib/spaces-invoke'
import {
    buildGraphModel, closestTo, DEFAULT_GRAPH_SETTINGS, formatWeight, GRAPH_HALF_LIVES, GRAPH_KINDS, labelOf, projectGraph,
    type DrawnGraph, type DrawnLink, type DrawnNode, type GraphModel, type GraphNodeType, type GraphSettings, type ModelEdge,
} from '@/lib/space-graph-model'
import { cn } from '@/lib/utils'

// The space graph (2026-11-12, harbor spec §8 Space graph): what a space's
// threads are about, as a picture to look through. Squares are threads,
// circles are what they touch. Clicking a node focuses it: its threads light
// up, and so does everything else those threads touch. The panel beside it
// says why each edge weighs what it does, down to the events, so nothing is
// asserted without a source. The server sends facts; the weights are computed
// here (lib/space-graph-model.ts), so the sliders never ask the server again.

const TYPE_LABEL: Record<GraphNodeType, string> = { person: 'People', agent: 'Agents', topic: 'Topics', reference: 'PRs and issues', code: 'Code identifiers', thread: 'Threads' }
const TYPE_ONE: Record<GraphNodeType, string> = { person: 'Person', agent: 'Agent', topic: 'Topic', reference: 'PR or issue', code: 'Code identifier', thread: 'Thread' }
const CATEGORY: Record<string, string> = { external_product: 'outside product', own_component: 'own component', feature: 'feature', practice: 'team practice', technology: 'technology' }
const ENTITY_TYPES: readonly GraphNodeType[] = ['person', 'agent', 'topic', 'reference', 'code']
/** While threads wait to be judged the view asks again, so a new graph fills in as it is built. */
const POLL_MS = 5_000
const MAX_LABELS = 80

interface SimNode extends DrawnNode { x?: number; y?: number; fx?: number; fy?: number }
interface SimLink extends Omit<DrawnLink, 'source' | 'target'> { source: string | SimNode; target: string | SimNode }
/** The slice of force-graph this view uses; the library's own types are for its chaining builder. */
interface ForceGraphApi {
    graphData(): { nodes: SimNode[]; links: SimLink[] }
    graphData(data: { nodes: SimNode[]; links: SimLink[] }): ForceGraphApi
    width(px: number): ForceGraphApi
    height(px: number): ForceGraphApi
    zoom(): number
    zoom(k: number, ms?: number): ForceGraphApi
    zoomToFit(ms?: number, padding?: number, filter?: (node: SimNode) => boolean): ForceGraphApi
    _destructor(): void
}
const endId = (end: string | SimNode): string => (typeof end === 'string' ? end : end.id)
const dateOf = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const percent = (p: number): string => `${Math.round(p * 100)}%`

function Dot({ type }: { type: GraphNodeType }) {
    return <span aria-hidden="true" className="space-graph-dot" data-type={type} style={{ background: `var(--graph-${type})` }} />
}

export function SpaceGraphView({ orgId, space, members, admin, refreshTick, onOpenThread, onOpenSettings }: {
    orgId: string
    space: spaces.Space
    members: readonly spaces.SpaceMember[]
    admin: boolean
    /** Bumped on any durable event in the space: a reason to ask again. */
    refreshTick: number
    onOpenThread: (rootMessageId: string) => void
    onOpenSettings: () => void
}) {
    const [graph, setGraph] = useState<spaces.SpaceGraph | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [settings, setSettings] = useState<GraphSettings>(DEFAULT_GRAPH_SETTINGS)
    const [selected, setSelected] = useState<string | null>(null)
    const [trail, setTrail] = useState<string[]>([])
    const [sort, setSort] = useState<'weight' | 'newest'>('weight')
    const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null)

    const [reload, setReload] = useState(0)
    useEffect(() => {
        let current = true
        invokeSpace('spaces:getSpaceGraph', { orgId, spaceId: space.id }).then(
            (next) => { if (current) { setGraph(next); setError(null) } },
            (err: unknown) => { if (current) setError(err instanceof Error ? err.message : 'Could not load the graph') },
        )
        return () => { current = false }
    }, [orgId, space.id, space.graph, refreshTick, reload])
    const waiting = graph !== null && (graph.status === 'building' || (graph.status === 'ready' && graph.pending > 0))
    useEffect(() => {
        if (!waiting) return
        const timer = setInterval(() => setReload((n) => n + 1), POLL_MS)
        return () => clearInterval(timer)
    }, [waiting])

    const agentIds = useMemo(() => new Set(members.filter((m) => m.kind === 'agent').map((m) => m.id)), [members])
    const model = useMemo(() => (graph && graph.status === 'ready' ? buildGraphModel(graph, settings, agentIds) : null), [graph, settings, agentIds])
    const drawn = useMemo(() => (model ? projectGraph(model, settings) : null), [model, settings])

    const focus = useCallback((id: string | null, back = false) => {
        setTip(null)
        setSelected((current) => {
            if (!back && current && id && current !== id) setTrail((t) => [...t.slice(-30), current])
            if (id === null) setTrail([])
            return id
        })
    }, [])
    const goBack = () => setTrail((t) => { const previous = t.at(-1); if (previous) focus(previous, true); return t.slice(0, -1) })

    if (error && !graph) return <div className="space-graph flex flex-1 items-start p-5"><SpacesEmpty icon={<Network />} title="Could not load the graph">{error}</SpacesEmpty></div>
    if (!graph) return <div className="space-graph flex flex-1 items-center justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
    if (graph.status === 'unavailable') return <div className="space-graph flex flex-1 items-start p-5"><SpacesEmpty icon={<Network />} title="The graph is not available on this server">It needs Jev, the model that judges what each thread is about, and this server has no key for it.</SpacesEmpty></div>
    if (graph.status === 'off') return <div className="space-graph flex flex-1 items-start p-5">
        <div><SpacesEmpty icon={<Network />} title="The graph is off for this space">{admin ? 'Turning it on sends this space’s messages to Jev, a decision model, to work out what each thread is about.' : 'An admin of this space can turn it on in Space settings.'}</SpacesEmpty>
            {admin && <Button variant="outline" className="ml-3" onClick={onOpenSettings}>Open Space settings</Button>}</div>
    </div>
    if (graph.status === 'building' || !model || !drawn) return <div className="space-graph flex flex-1 items-start p-5"><SpacesEmpty icon={<Loader2 className="animate-spin" />} title="Building the graph">{graph.pending > 0 ? `${graph.pending} threads to read. Recent ones come first, and a thread is read once it has been quiet for ten minutes.` : 'Reading this space’s threads.'}</SpacesEmpty></div>

    const set = (patch: Partial<GraphSettings>) => setSettings((s) => ({ ...s, ...patch }))
    const toggle = <T,>(current: ReadonlySet<T>, value: T): Set<T> => { const next = new Set(current); if (!next.delete(value)) next.add(value); return next }
    const kindCount = (kind: spaces.GraphThreadKind) => graph.threads.filter((t) => t.kind === kind).length
    const keptEdges = model.edges.filter((e) => e.kept)
    const heldByFloor = keptEdges.filter((e) => e.weight < model.cut).length

    return <div className="space-graph flex min-h-0 flex-1 text-[13px]">
        <aside aria-label="Graph options" className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-border p-4">
            <fieldset><legend className="mb-2 text-xs font-medium text-muted-foreground">Show</legend>
                {ENTITY_TYPES.map((type) => <label key={type} className="flex cursor-pointer items-center gap-2 py-0.5">
                    <input type="checkbox" className="size-3.5 accent-primary" checked={settings.types.has(type)} onChange={() => set({ types: toggle(settings.types, type) })} />
                    <Dot type={type} />{TYPE_LABEL[type]}</label>)}
                <label className="mt-2 flex cursor-pointer items-center gap-2 py-0.5"><input type="checkbox" className="size-3.5 accent-primary" checked={settings.threadsAsNodes} onChange={(e) => set({ threadsAsNodes: e.target.checked })} />Draw threads as nodes</label>
            </fieldset>
            <div><label htmlFor="graph-half-life" className="text-xs font-medium text-muted-foreground">Half-life: {settings.halfLifeDays === Infinity ? 'nothing fades' : `${settings.halfLifeDays} days`}</label>
                <input id="graph-half-life" type="range" className="mt-1 w-full accent-primary" min={0} max={GRAPH_HALF_LIVES.length - 1} step={1} value={Math.max(0, GRAPH_HALF_LIVES.indexOf(settings.halfLifeDays))}
                    onChange={(e) => set({ halfLifeDays: GRAPH_HALF_LIVES[Number(e.target.value)] ?? 60 })} />
                <p className="mt-1 text-xs text-muted-foreground">How fast old activity stops counting.</p></div>
            <div><label htmlFor="graph-keep" className="text-xs font-medium text-muted-foreground">Keep the strongest {settings.keep}% of edges</label>
                <input id="graph-keep" type="range" className="mt-1 w-full accent-primary" min={5} max={100} step={5} value={settings.keep} onChange={(e) => set({ keep: Number(e.target.value) })} />
                <p className="mt-1 text-xs text-muted-foreground">Pruning only hides. Nothing is deleted.</p>
                <label className="mt-2 flex cursor-pointer items-center gap-2 py-0.5"><input type="checkbox" className="size-3.5 accent-primary" checked={settings.importance} onChange={(e) => set({ importance: e.target.checked })} />Important threads count more</label>
                <label className="flex cursor-pointer items-center gap-2 py-0.5"><input type="checkbox" className="size-3.5 accent-primary" checked={settings.floor} onChange={(e) => set({ floor: e.target.checked })} />Never prune decision threads</label>
            </div>
            <fieldset><legend className="mb-2 text-xs font-medium text-muted-foreground">Threads in the graph</legend>
                <div className="flex flex-wrap gap-1">{GRAPH_KINDS.map((kind) => <button key={kind} type="button" aria-pressed={settings.kinds.has(kind)} onClick={() => set({ kinds: toggle(settings.kinds, kind) })}
                    className={cn('rounded-full border px-2 py-0.5 text-xs', settings.kinds.has(kind) ? 'border-border bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted')}>{kind} {kindCount(kind)}</button>)}</div>
                <p className="mt-2 text-xs text-muted-foreground">{keptEdges.length} of {model.edges.length} edges drawn{heldByFloor > 0 ? `, ${heldByFloor} only because a decision was made there` : ''}.{graph.pending > 0 ? ` ${graph.pending} threads still to read.` : ''}</p>
            </fieldset>
            <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setReload((n) => n + 1)}><RefreshCw className="size-3.5" />Refresh</Button>
        </aside>
        <GraphCanvas drawn={drawn} model={model} selected={selected} trail={trail} onFocus={focus} onBack={goBack} tip={tip} setTip={setTip} />
        <aside aria-label="Graph details" className="w-[360px] shrink-0 overflow-y-auto border-l border-border p-4">
            {selected === null
                ? <Overview model={model} settings={settings} onFocus={focus} />
                : selected.startsWith('thread:')
                    ? <ThreadPanel model={model} id={selected} members={members} onFocus={focus} onOpenThread={onOpenThread} />
                    : <EntityPanel model={model} id={selected} sort={sort} setSort={setSort} onFocus={focus} />}
        </aside>
    </div>
}

// --- the canvas ---------------------------------------------------------------------

function GraphCanvas({ drawn, model, selected, trail, onFocus, onBack, tip, setTip }: {
    drawn: DrawnGraph
    model: GraphModel
    selected: string | null
    trail: readonly string[]
    onFocus: (id: string | null) => void
    onBack: () => void
    tip: { x: number; y: number; body: ReactNode } | null
    setTip: (tip: { x: number; y: number; body: ReactNode } | null) => void
}) {
    const stage = useRef<HTMLDivElement>(null)
    const mount = useRef<HTMLDivElement>(null)
    const api = useRef<ForceGraphApi | null>(null)
    // What the canvas callbacks read. They are installed once; these change every render.
    const live = useRef({ drawn, model, selected, hover: null as string | null, near: new Set<string>(), far: new Set<string>(), focusId: null as string | null, pointer: { x: 0, y: 0 }, colors: new Map<string, string>(), dark: false, onFocus, setTip })
    live.current.drawn = drawn
    live.current.model = model
    live.current.selected = selected
    live.current.onFocus = onFocus
    live.current.setTip = setTip

    // One hop lights on hover. A selected thing also lights a second hop through its threads: what else those threads touch.
    const relight = useCallback(() => {
        const state = live.current
        const graph = api.current?.graphData()
        const present = new Set(graph?.nodes.map((n) => n.id))
        const chosen = state.selected !== null && present.has(state.selected) ? state.selected : null
        state.focusId = state.hover ?? chosen
        state.near = new Set()
        state.far = new Set()
        if (!state.focusId || !graph) return
        state.near.add(state.focusId)
        for (const l of graph.links) { const a = endId(l.source), b = endId(l.target); if (a === state.focusId) state.near.add(b); if (b === state.focusId) state.near.add(a) }
        if (state.focusId === chosen && !state.focusId.startsWith('thread:')) {
            for (const l of graph.links) {
                const a = endId(l.source), b = endId(l.target)
                if (a.startsWith('thread:') && state.near.has(a) && !state.near.has(b)) state.far.add(b)
                if (b.startsWith('thread:') && state.near.has(b) && !state.near.has(a)) state.far.add(a)
            }
        }
    }, [])

    useEffect(() => {
        const element = mount.current
        const container = stage.current
        if (!element || !container) return
        let disposed = false
        let observer: ResizeObserver | undefined
        const color = (name: string): string => {
            const state = live.current
            const dark = document.documentElement.classList.contains('dark')
            if (dark !== state.dark) { state.dark = dark; state.colors.clear() }
            let value = state.colors.get(name)
            if (value === undefined) state.colors.set(name, (value = getComputedStyle(container).getPropertyValue(name).trim() || '#888'))
            return value
        }
        const radius = (n: SimNode): number => (n.type === 'thread' ? 2 + Math.sqrt(n.weight / live.current.drawn.maxThread) * 5 : 4 + Math.sqrt(n.weight / live.current.drawn.maxEntity) * 12)
        const alpha = (id: string): number => { const s = live.current; return !s.focusId || s.near.has(id) ? 1 : s.far.has(id) ? 0.45 : 0.06 }
        const labels = (ctx: CanvasRenderingContext2D, scale: number): void => {
            const state = live.current
            const candidates: [number, SimNode][] = []
            for (const n of api.current?.graphData().nodes ?? []) {
                if (n.x === undefined || n.y === undefined) continue
                if (n.id === state.focusId) candidates.push([1e12, n])
                else if (state.focusId) { if (state.near.has(n.id)) candidates.push([1e8 + n.weight, n]); else if (state.far.has(n.id) && n.type !== 'thread') candidates.push([1e4 + n.weight, n]) }
                else if (n.type !== 'thread' && (n.top || radius(n) * scale >= 9)) candidates.push([(n.top ? 1e4 : 0) + n.weight, n])
            }
            candidates.sort((a, b) => b[0] - a[0])
            const placed: { x: number; y: number; w: number; h: number }[] = []
            for (const [, n] of candidates) {
                if (placed.length >= MAX_LABELS) break
                const strong = n.type === 'person' || n.type === 'agent' || n.id === state.focusId
                const size = (n.type === 'thread' ? 10.5 : 12) / scale
                ctx.font = `${strong ? '600 ' : ''}${size}px ui-sans-serif, system-ui, sans-serif`
                const text = n.label.length > 38 ? `${n.label.slice(0, 37)}…` : n.label
                const w = ctx.measureText(text).width + 8 / scale, h = size + 5 / scale
                const x = (n.x ?? 0) - w / 2, y = (n.y ?? 0) + radius(n) + 3 / scale
                // A label that would cover a heavier one is skipped: fewer labels, all readable.
                if (placed.some((p) => x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y)) continue
                placed.push({ x, y, w, h })
                ctx.globalAlpha = n.id !== state.focusId && state.far.has(n.id) ? 0.7 : 1
                ctx.fillStyle = color('--graph-halo')
                ctx.beginPath(); ctx.roundRect(x, y, w, h, 3 / scale); ctx.fill()
                ctx.fillStyle = color(n.type === 'thread' ? '--muted-foreground' : '--foreground')
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
                ctx.fillText(text, n.x ?? 0, y + h / 2)
            }
            ctx.globalAlpha = 1
        }
        const nodeTip = (n: SimNode): ReactNode => {
            const { model: m } = live.current
            const edges = m.byNode.get(n.id) ?? []
            const thread = m.threads.get(n.id)
            return <><div className="font-medium">{n.label}</div><div className="text-xs text-muted-foreground">{thread
                ? `${thread.kind} · ${dateOf(thread.startedAt)} · ${thread.messageCount} messages · importance ${thread.importance.toFixed(1)} of 4`
                : `${TYPE_ONE[n.type]} · ${edges.length} threads, ${edges.filter((e) => e.kept).length} drawn · weight ${formatWeight(n.weight)}`}</div></>
        }
        const linkTip = (l: SimLink): ReactNode => {
            const { model: m } = live.current
            const a = endId(l.source), b = endId(l.target)
            const edge = (m.byNode.get(a) ?? []).find((e) => (e.threadId === a && e.edge.entityId === b) || (e.threadId === b && e.edge.entityId === a))
            if (!edge) return <><div className="font-medium">{labelOf(m, a)} and {labelOf(m, b)}</div><div className="text-xs text-muted-foreground">Share {l.threads ?? 0} {l.threads === 1 ? 'thread' : 'threads'}</div></>
            return <><div className="font-medium">{labelOf(m, edge.edge.entityId)} in “{edge.thread.title}”</div><div className="text-xs text-muted-foreground">Weight {formatWeight(edge.weight)} · {describeEdge(edge)}</div></>
        }
        void import('force-graph').then(({ default: ForceGraph }) => {
            if (disposed) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- force-graph's builder types do not survive a custom node shape; the calls below are its documented API
            const fg: any = new (ForceGraph as any)(element)
            fg.backgroundColor('rgba(0,0,0,0)').nodeId('id').nodeLabel(() => '').nodeVal((n: SimNode) => radius(n) ** 2 / 4)
                .linkColor((l: SimLink) => {
                    const s = live.current, a = endId(l.source), b = endId(l.target)
                    if (!s.focusId) return color('--graph-edge')
                    if (a === s.focusId || b === s.focusId) return color('--graph-topic')
                    return s.near.has(a) || s.near.has(b) ? color('--graph-edge') : color('--graph-edge-faint')
                })
                .linkWidth((l: SimLink) => Math.min(4.5, 0.4 + Math.sqrt(l.weight / live.current.model.max) * 5))
                .linkLineDash((l: SimLink) => (l.floor ? [2, 2] : null))
                .nodeCanvasObject((n: SimNode, ctx: CanvasRenderingContext2D, scale: number) => {
                    const s = live.current, r = radius(n), x = n.x ?? 0, y = n.y ?? 0
                    ctx.globalAlpha = alpha(n.id)
                    ctx.fillStyle = color(`--graph-${n.type}`)
                    ctx.beginPath()
                    if (n.type === 'thread') ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3); else ctx.arc(x, y, r, 0, 2 * Math.PI)
                    ctx.fill()
                    if (n.floor) { ctx.lineWidth = 1 / scale; ctx.strokeStyle = color('--graph-floor'); ctx.stroke() }
                    if (n.id === s.selected || n.id === s.hover) { ctx.lineWidth = 2.5 / scale; ctx.strokeStyle = color('--foreground'); ctx.stroke() }
                    ctx.globalAlpha = 1
                })
                .nodePointerAreaPaint((n: SimNode, paint: string, ctx: CanvasRenderingContext2D) => { ctx.fillStyle = paint; ctx.beginPath(); ctx.arc(n.x ?? 0, n.y ?? 0, radius(n) + 2, 0, 2 * Math.PI); ctx.fill() })
                .onRenderFramePost(labels)
                .onNodeHover((n: SimNode | null) => { const s = live.current; s.hover = n?.id ?? null; element.style.cursor = n ? 'pointer' : ''; relight(); s.setTip(n ? { ...s.pointer, body: nodeTip(n) } : null) })
                .onLinkHover((l: SimLink | null) => {
                    const s = live.current
                    if (s.hover) return
                    // While focused, the faded lines are background: they neither explain themselves nor take clicks.
                    const lit = l && (!s.focusId || s.near.has(endId(l.source)) || s.near.has(endId(l.target)))
                    element.style.cursor = lit ? 'pointer' : ''
                    s.setTip(lit && l ? { ...s.pointer, body: linkTip(l) } : null)
                })
                .onLinkClick((l: SimLink) => { const s = live.current, a = endId(l.source), b = endId(l.target); if (s.focusId && !s.near.has(a) && !s.near.has(b)) s.onFocus(null); else s.onFocus(a.startsWith('thread:') ? a : b) })
                .onNodeClick((n: SimNode) => live.current.onFocus(n.id))
                .onNodeDragEnd((n: SimNode) => { n.fx = n.x; n.fy = n.y })
                .onBackgroundClick(() => live.current.onFocus(null))
                .cooldownTime(7000).d3VelocityDecay(0.35)
            fg.d3Force('charge').strength((n: SimNode) => -70 - radius(n) * 16).distanceMax(800)
            // People are in most threads; a weak pull keeps them from collapsing the map onto themselves.
            fg.d3Force('link').distance(42).strength((l: SimLink) => { const hub = (end: string | SimNode) => typeof end !== 'string' && (end.type === 'person' || end.type === 'agent'); return hub(l.source) || hub(l.target) ? 0.05 : 0.35 })
            const frame = () => { if (live.current.selected === null) fg.zoomToFit(600, 40, (n: SimNode) => n.main) }
            fg.onEngineStop(frame)
            setTimeout(frame, 3000)
            const fit = () => fg.width(container.clientWidth).height(container.clientHeight)
            observer = new ResizeObserver(fit)
            observer.observe(container)
            fit()
            api.current = fg as ForceGraphApi
            fg.graphData({ nodes: live.current.drawn.nodes.map((n) => ({ ...n })), links: live.current.drawn.links.map((l) => ({ ...l })) })
            relight()
        })
        return () => { disposed = true; observer?.disconnect(); api.current?._destructor(); api.current = null }
    }, [relight])

    // New data keeps each node where it was, so moving a slider reshapes the graph without restarting it.
    useEffect(() => {
        const fg = api.current
        if (!fg) return
        const old = new Map(fg.graphData().nodes.map((n) => [n.id, n]))
        fg.graphData({ nodes: drawn.nodes.map((n) => Object.assign(old.get(n.id) ?? {}, n) as SimNode), links: drawn.links.map((l) => ({ ...l })) })
        relight()
    }, [drawn, relight])

    useEffect(() => {
        live.current.hover = null
        relight()
        const fg = api.current
        if (!fg) return
        if (selected !== null && live.current.near.size > 0) fg.zoomToFit(700, 70, (n) => live.current.near.has(n.id))
        else if (selected === null) fg.zoomToFit(600, 40, (n) => n.main)
    }, [selected, relight])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && live.current.selected !== null && !(e.target instanceof HTMLInputElement)) live.current.onFocus(null) }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [])

    const zoomBy = (factor: number) => { const fg = api.current; if (fg) fg.zoom(fg.zoom() * factor, 300) }
    return <div ref={stage} className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        onMouseMove={(e) => { const box = e.currentTarget.getBoundingClientRect(); live.current.pointer = { x: Math.min(e.clientX - box.left + 14, box.width - 300), y: Math.min(e.clientY - box.top + 14, box.height - 80) } }}
        onMouseLeave={() => setTip(null)}>
        <div ref={mount} className="absolute inset-0" />
        {selected !== null && <div className="absolute left-3 top-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-lg border border-border bg-background py-1 pl-3 pr-1">
            <span className="text-xs text-muted-foreground">Focused on</span>
            <span className="max-w-72 truncate font-medium">{labelOf(model, selected)}</span>
            {trail.length > 0 && <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="size-3.5" />Back</Button>}
            <Button variant="ghost" size="sm" onClick={() => onFocus(null)}>Show all</Button>
        </div>}
        {tip && <div role="tooltip" className="pointer-events-none absolute z-10 max-w-72 rounded-lg border border-border bg-background px-3 py-2 shadow-[var(--rowboat-shadow-soft)]" style={{ left: tip.x, top: tip.y }}>{tip.body}</div>}
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-140px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1 text-xs text-muted-foreground" style={{ background: 'var(--graph-halo)' }}>
            {(['person', 'agent', 'topic', 'reference', 'thread'] as const).map((type) => <span key={type} className="inline-flex items-center gap-1.5"><Dot type={type} />{TYPE_LABEL[type]}</span>)}
        </div>
        <div className="absolute bottom-3 right-3 flex gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(1.5)}><Plus className="size-3.5" /></Button>
            <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)}><Minus className="size-3.5" /></Button>
            <Button variant="outline" size="icon-sm" aria-label="Fit the graph" onClick={() => api.current?.zoomToFit(500, 40, (n) => (live.current.focusId ? live.current.near.has(n.id) : n.main))}><Maximize2 className="size-3.5" /></Button>
        </div>
    </div>
}

// --- the panel ----------------------------------------------------------------------

function describeEdge(edge: ModelEdge): string {
    const days = Math.max(0, Math.round((Date.parse(edge.thread.lastAt) - edge.lastAt) / 86_400_000))
    const count = edge.edge.events.length
    const relation = edge.edge.relation === 'participant' ? 'took part' : edge.edge.relation
    return `${relation}${edge.edge.probability !== null ? ` ${percent(edge.edge.probability)}` : ''} · ${count} ${count === 1 ? 'message' : 'messages'}${days > 0 ? `, the last ${days}d before the thread ended` : ''}`
}

function Heading({ children }: { children: ReactNode }) {
    return <h3 className="mb-1 mt-5 text-xs font-medium text-muted-foreground">{children}</h3>
}

function Row({ type, label, meta, detail, dim, onClick }: { type: GraphNodeType; label: string; meta?: ReactNode; detail?: ReactNode; dim?: boolean; onClick: () => void }) {
    return <button type="button" onClick={onClick} className={cn('-mx-2 block w-[calc(100%+16px)] rounded-md px-2 py-1 text-left hover:bg-muted', dim && 'opacity-50')}>
        <span className="flex items-baseline gap-2"><Dot type={type} /><span className="min-w-0 flex-1 truncate" title={label}>{label}</span>{meta !== undefined && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}</span>
        {detail !== undefined && <span className="ml-[17px] flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{detail}</span>}
    </button>
}

function WeightBar({ model, weight }: { model: GraphModel; weight: number }) {
    return <span aria-hidden="true" className="inline-block h-1 rounded-full bg-[var(--graph-topic)] align-middle" style={{ width: Math.max(2, Math.round(Math.sqrt(weight / model.max) * 64)) }} />
}

function EdgeRow({ model, edge, show, onFocus }: { model: GraphModel; edge: ModelEdge; show: 'thread' | 'entity'; onFocus: (id: string) => void }) {
    const id = show === 'thread' ? edge.threadId : edge.edge.entityId
    const why = `This thread ${formatWeight(edge.threadSide)} + half of ${formatWeight(edge.entitySide)} from everywhere, × ${edge.edge.strength} for the judgment × ${edge.importanceFactor.toFixed(2)} for importance`
    return <Row type={model.typeOf(id)} label={labelOf(model, id)} meta={formatWeight(edge.weight)} dim={!edge.kept} onClick={() => onFocus(id)}
        detail={<><WeightBar model={model} weight={edge.weight} /><span title={why}>{describeEdge(edge)}</span>
            {show === 'thread' && <span>{edge.thread.kind}</span>}
            {show === 'thread' && edge.thread.resolved >= 0.5 && <span className="text-[var(--rowboat-success)]">resolved</span>}
            {edge.kept && edge.weight < model.cut && <span className="text-[var(--graph-floor)]" title="Below the prune line, but a decision was made in this thread">kept: decision</span>}
            {!edge.kept && <span>pruned</span>}</>} />
}

function Closest({ model, id, threads, onFocus }: { model: GraphModel; id: string; threads: boolean; onFocus: (id: string) => void }) {
    const list = useMemo(() => closestTo(model, id).filter((x) => x.id.startsWith('thread:') === threads).slice(0, 8), [model, id, threads])
    const top = list[0]?.score || 1
    if (list.length === 0) return null
    return <><Heading>{threads ? 'Closest threads' : 'Closest to this'}</Heading>
        {list.map((x) => <Row key={x.id} type={model.typeOf(x.id)} label={labelOf(model, x.id)} onClick={() => onFocus(x.id)}
            meta={<span aria-hidden="true" className="inline-block h-1 rounded-full bg-[var(--graph-topic)]" style={{ width: Math.max(2, Math.round(x.score / top * 48)) }} />} />)}</>
}

function Overview({ model, settings, onFocus }: { model: GraphModel; settings: GraphSettings; onFocus: (id: string) => void }) {
    const totals = useMemo(() => [...model.byNode.entries()].map(([id, edges]) => ({ id, type: model.typeOf(id), weight: edges.reduce((sum, e) => sum + e.weight, 0) })).sort((a, b) => b.weight - a.weight), [model])
    return <>
        <h2 className="text-base font-medium">What this space is about</h2>
        <p className="mt-1 text-sm text-muted-foreground">Squares are threads; circles are what they touch. Click anything to focus on it, and hover a node or a line to see what it is.</p>
        {([['topic', 10], ['agent', 6], ['person', 6], ['reference', 6], ['thread', 10]] as const).map(([type, count]) => {
            const list = totals.filter((t) => t.type === type).slice(0, count)
            if (list.length === 0 || (type !== 'thread' && !settings.types.has(type))) return null
            return <div key={type}><Heading>Heaviest {type === 'reference' ? 'PRs and issues' : TYPE_LABEL[type].toLowerCase()}</Heading>
                {list.map((t) => <Row key={t.id} type={type} label={labelOf(model, t.id)} meta={formatWeight(t.weight)} onClick={() => onFocus(t.id)} />)}</div>
        })}
    </>
}

function EntityPanel({ model, id, sort, setSort, onFocus }: { model: GraphModel; id: string; sort: 'weight' | 'newest'; setSort: (sort: 'weight' | 'newest') => void; onFocus: (id: string) => void }) {
    const entity = model.entities.get(id)
    const type = model.typeOf(id)
    const edges = useMemo(() => [...(model.byNode.get(id) ?? [])].sort((a, b) => (sort === 'weight' ? b.weight - a.weight : Date.parse(b.thread.lastAt) - Date.parse(a.thread.lastAt))), [model, id, sort])
    const parts = new Map<string, number>()
    for (const e of edges) parts.set(e.edge.relation, (parts.get(e.edge.relation) ?? 0) + 1)
    return <>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Dot type={type} />{TYPE_ONE[type]}{entity?.category ? ` · ${CATEGORY[entity.category] ?? entity.category}` : ''}</p>
        <h2 className="mt-1 break-words text-base font-medium">{entity?.label ?? id}</h2>
        {entity && entity.aliases.length > 0 && <p className="text-sm text-muted-foreground">Also “{entity.aliases.join('”, “')}”</p>}
        {entity?.url && <a href={entity.url} target="_blank" rel="noreferrer" className="text-sm text-[var(--rowboat-link)] hover:underline">Open on GitHub</a>}
        {edges.length === 0
            ? <p className="mt-3 text-sm text-muted-foreground">Nothing at the current filters.</p>
            : <p className="mt-2 text-sm text-muted-foreground">{edges.length} {edges.length === 1 ? 'thread' : 'threads'}, {edges.filter((e) => e.kept).length} drawn.</p>}
        {(type === 'person' || type === 'agent') && parts.size > 0 && <><Heading>Part played, as Jev judged it</Heading>
            <p className="flex flex-wrap gap-1">{[...parts.entries()].sort((a, b) => b[1] - a[1]).map(([relation, count]) => <span key={relation} className="rounded-full bg-muted px-2 py-0.5 text-xs">{relation === 'participant' ? 'took part' : relation} {count}</span>)}</p></>}
        <Closest model={model} id={id} threads={false} onFocus={onFocus} />
        {edges.length > 0 && <><div className="mb-1 mt-5 flex items-center gap-2"><h3 className="text-xs font-medium text-muted-foreground">Threads</h3>
            {(['weight', 'newest'] as const).map((s) => <button key={s} type="button" aria-pressed={sort === s} onClick={() => setSort(s)} className={cn('rounded-full px-2 py-0.5 text-xs', sort === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted')}>{s === 'weight' ? 'By weight' : 'Newest'}</button>)}</div>
            {edges.slice(0, 80).map((e) => <EdgeRow key={e.threadId} model={model} edge={e} show="thread" onFocus={onFocus} />)}
            {edges.length > 80 && <p className="mt-1 text-xs text-muted-foreground">And {edges.length - 80} more.</p>}</>}
    </>
}

function Meter({ label, value, text }: { label: string; value: number; text: string }) {
    return <div className="grid grid-cols-[104px_1fr_44px] items-center gap-2 py-0.5">
        <span>{label}</span>
        <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-[var(--graph-topic)]" style={{ width: percent(Math.min(1, Math.max(0, value))) }} /></span>
        <span className="text-right text-xs tabular-nums text-muted-foreground">{text}</span>
    </div>
}

function ThreadPanel({ model, id, members, onFocus, onOpenThread }: { model: GraphModel; id: string; members: readonly spaces.SpaceMember[]; onFocus: (id: string) => void; onOpenThread: (rootMessageId: string) => void }) {
    const thread = model.threads.get(id)
    const edges = useMemo(() => [...(model.byNode.get(id) ?? [])].sort((a, b) => b.weight - a.weight), [model, id])
    if (!thread) return <p className="text-sm text-muted-foreground">This thread is no longer in the graph.</p>
    const nameOf = (memberId: string) => members.find((m) => m.id === memberId)?.displayName ?? 'A former member'
    return <>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Dot type="thread" />Thread · {dateOf(thread.startedAt)} · {thread.messageCount} {thread.messageCount === 1 ? 'message' : 'messages'}</p>
        <h2 className="mt-1 break-words text-base font-medium">{thread.title}</h2>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => onOpenThread(thread.rootMessageId)}>Open thread</Button>
        {[['Opened by', thread.opening], ['Latest from', thread.latest]].map(([label, quote]) => quote && typeof quote !== 'string' && <blockquote key={label as string} className="mt-3 break-words border-l-2 border-border pl-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{label as string} {nameOf(quote.memberId)}: </span>{quote.text}</blockquote>)}
        <Heading>As Jev judged it</Heading>
        <Meter label={thread.kind} value={thread.kindProbability} text={percent(thread.kindProbability)} />
        <Meter label="Resolved" value={thread.resolved} text={percent(thread.resolved)} />
        <Meter label="Decision made" value={thread.decision} text={percent(thread.decision)} />
        <Meter label="Importance" value={thread.importance / 4} text={`${thread.importance.toFixed(1)} of 4`} />
        {edges.length === 0 && <p className="mt-3 text-sm text-muted-foreground">This kind of thread is switched off under “Threads in the graph”.</p>}
        {ENTITY_TYPES.map((type) => {
            const list = edges.filter((e) => model.typeOf(e.edge.entityId) === type)
            return list.length > 0 && <div key={type}><Heading>{TYPE_LABEL[type]}</Heading>{list.map((e) => <EdgeRow key={e.edge.entityId} model={model} edge={e} show="entity" onFocus={onFocus} />)}</div>
        })}
        <Closest model={model} id={id} threads onFocus={onFocus} />
    </>
}
