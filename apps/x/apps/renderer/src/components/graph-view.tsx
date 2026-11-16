import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

export type GraphNode = {
  id: string
  label: string
  degree: number
  radius: number
  group: string
  color: string
  stroke: string
}

export type GraphEdge = {
  source: string
  target: string
}

type GraphViewProps = {
  nodes: GraphNode[]
  edges: GraphEdge[]
  isLoading?: boolean
  error?: string | null
  onSelectNode?: (id: string) => void
}

type NodePosition = {
  x: number
  y: number
  vx: number
  vy: number
}

const SIMULATION_STEPS = 240
const SPRING_LENGTH = 80
const SPRING_STRENGTH = 0.0038
const REPULSION = 5800
const DAMPING = 0.83
const MIN_DISTANCE = 34
const CLUSTER_STRENGTH = 0.0018
const MAX_SPEED = 60
const CLUSTER_RADIUS_MIN = 120
const CLUSTER_RADIUS_MAX = 240
const CLUSTER_RADIUS_STEP = 45
const FLOAT_BASE = 3.5
const FLOAT_VARIANCE = 2
const FLOAT_SPEED_BASE = 0.0006
const FLOAT_SPEED_VARIANCE = 0.00025

/** A link between two notes, drawn as a shallow arc. */
function arcPath(source: { x: number; y: number }, target: { x: number; y: number }) {
  const dr = Math.hypot(target.x - source.x, target.y - source.y) * 1.5
  return `M${source.x},${source.y}A${dr},${dr} 0 0,1 ${target.x},${target.y}`
}

export function GraphView({ nodes, edges, error, onSelectNode }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const positionsRef = useRef<Map<string, NodePosition>>(new Map())
  const motionSeedsRef = useRef<Map<string, { phase: number; amplitude: number; speed: number }>>(new Map())
  const motionTimeRef = useRef(0)
  const draggingRef = useRef<{
    id: string
    offsetX: number
    offsetY: number
    moved: boolean
  } | null>(null)
  const panningRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const hasCenteredRef = useRef(false)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(0.6)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [, forceRender] = useState(0)
  // Each frame of the layout and the idle float moves the elements directly
  // instead of re-rendering through React (2026-10-22): with ~550 notes and
  // ~600 links a React pass took ~80ms, so the app dropped to ~12fps for as
  // long as the Brain graph was open. React still renders on hover, search
  // and data changes.
  const nodeElsRef = useRef(new Map<string, SVGGElement>())
  const edgeElsRef = useRef<(SVGPathElement | null)[]>([])
  const paintEdgesRef = useRef<GraphEdge[]>([])

  const edgeList = useMemo(
    () => edges.filter((edge) => edge.source !== edge.target),
    [edges]
  )
  const nodeGroupMap = useMemo(() => {
    const map = new Map<string, string>()
    nodes.forEach((node) => map.set(node.id, node.group || 'root'))
    return map
  }, [nodes])
  const legendItems = useMemo(() => {
    const grouped = new Map<string, { group: string; label: string; color: string; stroke: string }>()
    nodes.forEach((node) => {
      const group = node.group || 'root'
      if (grouped.has(group)) return
      grouped.set(group, {
        group,
        label: group === 'root' ? 'knowledge' : group,
        color: node.color,
        stroke: node.stroke,
      })
    })
    return Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label))
  }, [nodes])
  const groupCenters = useMemo(() => {
    const groups = Array.from(new Set(nodes.map((node) => node.group || 'root')))
    if (groups.length === 0) return new Map<string, { x: number; y: number }>()
    const radius = Math.min(
      CLUSTER_RADIUS_MAX,
      Math.max(CLUSTER_RADIUS_MIN, groups.length * CLUSTER_RADIUS_STEP)
    )
    const centers = new Map<string, { x: number; y: number }>()
    groups.forEach((group, index) => {
      const angle = (index / groups.length) * Math.PI * 2
      centers.set(group, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
      })
    })
    return centers
  }, [nodes])

  const getMotionSeed = useCallback((id: string) => {
    const existing = motionSeedsRef.current.get(id)
    if (existing) return existing
    let hash = 0
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash << 5) - hash + id.charCodeAt(i)
      hash |= 0
    }
    const normalized = Math.abs(hash)
    const phase = ((normalized % 360) * Math.PI) / 180
    const amplitude = FLOAT_BASE + (normalized % 7) * (FLOAT_VARIANCE / 6)
    const speed = FLOAT_SPEED_BASE + (normalized % 5) * FLOAT_SPEED_VARIANCE
    const seed = { phase, amplitude, speed }
    motionSeedsRef.current.set(id, seed)
    return seed
  }, [])

  const getDisplayPosition = useCallback((id: string, base: NodePosition, skipMotion: boolean) => {
    if (skipMotion) {
      return { x: base.x, y: base.y }
    }
    const seed = getMotionSeed(id)
    const phase = seed.phase + motionTimeRef.current * seed.speed
    return {
      x: base.x + Math.sin(phase) * seed.amplitude,
      y: base.y + Math.cos(phase * 0.9) * seed.amplitude,
    }
  }, [getMotionSeed])

  const paint = useCallback(() => {
    const positions = positionsRef.current
    const draggingId = draggingRef.current?.id
    const shown = new Map<string, { x: number; y: number }>()
    nodeElsRef.current.forEach((el, id) => {
      const pos = positions.get(id)
      if (!pos) return
      const point = getDisplayPosition(id, pos, draggingId === id)
      shown.set(id, point)
      el.setAttribute('transform', `translate(${point.x} ${point.y})`)
    })
    paintEdgesRef.current.forEach((edge, index) => {
      const el = edgeElsRef.current[index]
      const source = shown.get(edge.source)
      const target = shown.get(edge.target)
      if (el && source && target) el.setAttribute('d', arcPath(source, target))
    })
  }, [getDisplayPosition])

  useEffect(() => {
    paintEdgesRef.current = edgeList
  }, [edgeList])

  const getGraphPoint = useCallback((event: React.PointerEvent) => {
    const container = containerRef.current
    if (!container) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom,
    }
  }, [pan.x, pan.y, zoom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setViewport({ width, height })
      if (!hasCenteredRef.current) {
        setPan({ x: width / 2, y: height / 2 })
        hasCenteredRef.current = true
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // The app rebuilds graph data whenever the notes tree refreshes, with new
  // arrays but usually the same notes and links. Restart the layout only when
  // the shape changes (2026-10-22: each restart re-ran 240 heavy frames).
  const layoutKey = useMemo(
    () => `${nodes.map((node) => `${node.id}:${node.group}`).join('\n')}|${edgeList.map((edge) => `${edge.source}>${edge.target}`).join('\n')}`,
    [nodes, edgeList]
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layoutInput = useMemo(() => ({ nodes, edgeList, groupCenters, nodeGroupMap }), [layoutKey])

  useEffect(() => {
    const { nodes, edgeList, groupCenters, nodeGroupMap } = layoutInput
    if (nodes.length === 0) {
      positionsRef.current = new Map()
      return
    }

    const nextPositions = new Map<string, NodePosition>()
    const count = nodes.length
    const radius = Math.max(110, Math.min(220, count * 9))

    nodes.forEach((node, index) => {
      const existing = positionsRef.current.get(node.id)
      if (existing && Number.isFinite(existing.x) && Number.isFinite(existing.y)) {
        nextPositions.set(node.id, { ...existing })
        return
      }
      const angle = (index / count) * Math.PI * 2
      nextPositions.set(node.id, {
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        vx: 0,
        vy: 0,
      })
    })

    positionsRef.current = nextPositions
    forceRender((prev) => prev + 1)

    let step = 0
    let rafId = 0
    let active = true

    // The layout runs on plain arrays (2026-10-22): the old per-pair Map
    // lookups made each step of ~550 notes cost tens of milliseconds.
    const ids = nodes.map((node) => node.id)
    const list = ids.map((id) => nextPositions.get(id)!)
    const indexOf = new Map(ids.map((id, index) => [id, index]))
    const links = edgeList.flatMap((edge) => {
      const a = indexOf.get(edge.source)
      const b = indexOf.get(edge.target)
      return a === undefined || b === undefined ? [] : [[a, b] as const]
    })
    const centers = ids.map((id) => groupCenters.get(nodeGroupMap.get(id) ?? 'root') ?? null)
    const fx = new Float64Array(ids.length)
    const fy = new Float64Array(ids.length)

    const simulate = () => {
      if (!active) return
      step += 1
      fx.fill(0)
      fy.fill(0)

      for (let i = 0; i < list.length; i += 1) {
        const posA = list[i]
        for (let j = i + 1; j < list.length; j += 1) {
          const posB = list[j]
          const dx = posB.x - posA.x
          const dy = posB.y - posA.y
          const distance = Math.max(MIN_DISTANCE, Math.sqrt(dx * dx + dy * dy))
          const force = REPULSION / (distance * distance * distance)
          fx[i] -= force * dx
          fy[i] -= force * dy
          fx[j] += force * dx
          fy[j] += force * dy
        }
      }

      for (const [a, b] of links) {
        const posA = list[a]
        const posB = list[b]
        const dx = posB.x - posA.x
        const dy = posB.y - posA.y
        const distance = Math.max(20, Math.sqrt(dx * dx + dy * dy))
        const force = ((distance - SPRING_LENGTH) * SPRING_STRENGTH) / distance
        fx[a] += force * dx
        fy[a] += force * dy
        fx[b] -= force * dx
        fy[b] -= force * dy
      }

      const draggingId = draggingRef.current?.id
      for (let i = 0; i < list.length; i += 1) {
        const pos = list[i]
        const center = centers[i]
        if (center) {
          fx[i] += (center.x - pos.x) * CLUSTER_STRENGTH
          fy[i] += (center.y - pos.y) * CLUSTER_STRENGTH
        }
        if (draggingId === ids[i]) {
          pos.vx = 0
          pos.vy = 0
          continue
        }
        pos.vx = (pos.vx + fx[i]) * DAMPING
        pos.vy = (pos.vy + fy[i]) * DAMPING
        // Cap the speed and drop bad numbers (2026-10-22): one runaway or NaN
        // node spreads to every node through repulsion, and the whole graph
        // then draws as a single pile at the centre.
        const speed = Math.sqrt(pos.vx * pos.vx + pos.vy * pos.vy)
        if (!Number.isFinite(speed)) {
          pos.vx = 0
          pos.vy = 0
        } else if (speed > MAX_SPEED) {
          pos.vx = (pos.vx / speed) * MAX_SPEED
          pos.vy = (pos.vy / speed) * MAX_SPEED
        }
        pos.x += pos.vx
        pos.y += pos.vy
        if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
          pos.x = (Math.random() - 0.5) * radius * 2
          pos.y = (Math.random() - 0.5) * radius * 2
        }
      }

      paint()

      if (step < SIMULATION_STEPS) {
        rafId = requestAnimationFrame(simulate)
      }
    }

    rafId = requestAnimationFrame(simulate)
    return () => {
      active = false
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [layoutInput, paint])

  useEffect(() => {
    if (nodes.length === 0) return
    let rafId = 0
    let lastTime = performance.now()

    const animate = (time: number) => {
      const delta = time - lastTime
      if (delta >= 32) {
        motionTimeRef.current += delta
        lastTime = time
        paint()
      }
      rafId = requestAnimationFrame(animate)
    }

    rafId = requestAnimationFrame(animate)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [nodes.length, paint])

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panningRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    }
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const dragging = draggingRef.current
    if (dragging) {
      const point = getGraphPoint(event)
      const pos = positionsRef.current.get(dragging.id)
      if (pos && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        pos.x = point.x - dragging.offsetX
        pos.y = point.y - dragging.offsetY
        dragging.moved = true
        paint()
      }
      return
    }

    const panning = panningRef.current
    if (panning) {
      setPan({
        x: panning.originX + (event.clientX - panning.startX),
        y: panning.originY + (event.clientY - panning.startY),
      })
    }
  }

  const handlePointerUp = () => {
    const dragging = draggingRef.current
    if (dragging) {
      if (!dragging.moved) {
        onSelectNode?.(dragging.id)
      }
      draggingRef.current = null
    }
    panningRef.current = null
  }

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault()
    const rawDelta = event.deltaY
    const normalizedDelta = event.deltaMode === 1
      ? rawDelta * 16
      : event.deltaMode === 2
        ? rawDelta * viewport.height
        : rawDelta
    const sensitivity = Math.abs(normalizedDelta) < 40 ? 0.004 : 0.0022
    const zoomFactor = Math.exp(-normalizedDelta * sensitivity)
    const nextZoom = Math.min(2.5, Math.max(0.4, zoom * zoomFactor))
    if (nextZoom === zoom || !Number.isFinite(nextZoom)) return

    const container = containerRef.current
    if (!container) {
      setZoom(nextZoom)
      return
    }

    const rect = container.getBoundingClientRect()
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    const graphX = (cursorX - pan.x) / zoom
    const graphY = (cursorY - pan.y) / zoom
    setZoom(nextZoom)
    setPan({
      x: cursorX - graphX * nextZoom,
      y: cursorY - graphY * nextZoom,
    })
  }

  const startDragNode = (event: React.PointerEvent, nodeId: string) => {
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getGraphPoint(event)
    const pos = positionsRef.current.get(nodeId)
    if (!pos) return
    const displayPos = getDisplayPosition(nodeId, pos, false)
    draggingRef.current = {
      id: nodeId,
      offsetX: point.x - displayPos.x,
      offsetY: point.y - displayPos.y,
      moved: false,
    }
  }

  const displayPositions = new Map<string, { x: number; y: number }>()
  nodes.forEach((node) => {
    const pos = positionsRef.current.get(node.id)
    if (!pos) return
    const isDragging = draggingRef.current?.id === node.id
    displayPositions.set(node.id, getDisplayPosition(node.id, pos, isDragging))
  })
  const activeNodeId = hoveredNodeId ?? draggingRef.current?.id ?? null
  const connectedNodes = useMemo(() => {
    if (!activeNodeId) return null
    const set = new Set([activeNodeId])
    edgeList.forEach((edge) => {
      if (edge.source === activeNodeId) set.add(edge.target)
      if (edge.target === activeNodeId) set.add(edge.source)
    })
    return set
  }, [activeNodeId, edgeList])

  const searchMatchingNodes = useMemo(() => {
    if (!searchQuery.trim()) return null
    const query = searchQuery.toLowerCase()
    const directMatches = new Set<string>()
    nodes.forEach((node) => {
      if (node.label.toLowerCase().includes(query) || node.id.toLowerCase().includes(query)) {
        directMatches.add(node.id)
      }
    })
    // Include immediate connections of matching nodes
    const withConnections = new Set(directMatches)
    edgeList.forEach((edge) => {
      if (directMatches.has(edge.source)) withConnections.add(edge.target)
      if (directMatches.has(edge.target)) withConnections.add(edge.source)
    })
    return { matches: withConnections, directMatches }
  }, [searchQuery, nodes, edgeList])

  return (
    <div ref={containerRef} className="graph-view relative h-full w-full">
{error ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!error && nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No notes found.
        </div>
      ) : null}

      {legendItems.length > 0 ? (
        <div
          className="absolute right-3 top-3 z-20 rounded-md border-none bg-[var(--rowboat-raised)] px-3 py-2 text-xs text-foreground shadow-[var(--rowboat-shadow-soft)]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 text-[13px] text-muted-foreground">
            Folders
          </div>
          <div className="grid gap-1">
            {legendItems.map((item) => {
              const isSelected = selectedGroup === item.group
              return (
                <button
                  key={item.group}
                  onClick={() => setSelectedGroup(isSelected ? null : item.group)}
                  className={`flex items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-foreground/10 ${
                    isSelected ? 'bg-foreground/15' : ''
                  }`}
                >
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color, boxShadow: `0 0 0 1px ${item.stroke}` }}
                  />
                  <span className="truncate">{item.label}</span>
                  <X className={`ml-auto size-3 ${isSelected ? 'text-muted-foreground' : 'invisible'}`} />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      <svg
        className="h-full w-full touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          handlePointerUp()
          setHoveredNodeId(null)
        }}
        onWheel={handleWheel}
      >
        <rect width={viewport.width} height={viewport.height} fill="transparent" />
        <defs>
          {Array.from(new Set(nodes.map((n) => n.color))).map((color) => (
            <filter
              key={color}
              id={`glow-${color.replace('#', '')}`}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="4" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          ))}
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edgeList.map((edge, index) => {
            const source = displayPositions.get(edge.source)
            const target = displayPositions.get(edge.target)
            if (!source || !target) return null
            const sourceGroup = nodeGroupMap.get(edge.source) ?? 'root'
            const targetGroup = nodeGroupMap.get(edge.target) ?? 'root'
            const isActiveEdge = activeNodeId
              ? edge.source === activeNodeId || edge.target === activeNodeId
              : false
            const isSearchEdge = searchMatchingNodes
              ? searchMatchingNodes.matches.has(edge.source) && searchMatchingNodes.matches.has(edge.target)
              : false
            const isGroupEdge = selectedGroup
              ? sourceGroup === selectedGroup && targetGroup === selectedGroup
              : false
            let strokeOpacity = 0.4
            let strokeWidth = 1
            if (selectedGroup) {
              strokeOpacity = isGroupEdge ? 0.6 : 0.05
              strokeWidth = isGroupEdge ? 1.5 : 1
            } else if (searchMatchingNodes) {
              strokeOpacity = isSearchEdge ? 0.6 : 0.05
              strokeWidth = isSearchEdge ? 1.5 : 1
            } else if (activeNodeId) {
              strokeOpacity = isActiveEdge ? 0.8 : 0.1
              strokeWidth = isActiveEdge ? 2 : 1
            }
            const activeNode = activeNodeId ? nodes.find((n) => n.id === activeNodeId) : null
            const stroke = isActiveEdge && activeNode ? activeNode.color : '#333'
            return (
              <path
                key={`${edge.source}-${edge.target}-${index}`}
                ref={(el) => { edgeElsRef.current[index] = el }}
                d={arcPath(source, target)}
                fill="none"
                stroke={stroke}
                strokeOpacity={strokeOpacity}
                strokeWidth={strokeWidth}
                style={{ transition: 'stroke 0.2s, stroke-opacity 0.2s, stroke-width 0.2s' }}
              />
            )
          })}

          {nodes.map((node) => {
            const pos = displayPositions.get(node.id)
            if (!pos) return null
            const nodeGroup = node.group || 'root'
            const isConnected = connectedNodes ? connectedNodes.has(node.id) : true
            const isSearchMatch = searchMatchingNodes ? searchMatchingNodes.matches.has(node.id) : true
            const isDirectMatch = searchMatchingNodes ? searchMatchingNodes.directMatches.has(node.id) : false
            const isGroupMatch = selectedGroup ? nodeGroup === selectedGroup : true
            const isPrimary = activeNodeId === node.id || isDirectMatch || (selectedGroup && isGroupMatch)
            let nodeOpacity = 1
            if (selectedGroup) {
              nodeOpacity = isGroupMatch ? 1 : 0.1
            } else if (searchMatchingNodes) {
              if (isDirectMatch) {
                nodeOpacity = 1
              } else if (isSearchMatch) {
                nodeOpacity = 0.5
              } else {
                nodeOpacity = 0.1
              }
            } else if (activeNodeId) {
              nodeOpacity = isConnected ? 1 : 0.3
            }
            const glowFilterId = `glow-${node.color.replace('#', '')}`
            return (
              <g
                key={node.id}
                ref={(el) => {
                  if (el) nodeElsRef.current.set(node.id, el)
                  else nodeElsRef.current.delete(node.id)
                }}
                transform={`translate(${pos.x} ${pos.y})`}
                className="cursor-pointer"
                onPointerEnter={() => setHoveredNodeId(node.id)}
                onPointerLeave={() => setHoveredNodeId(null)}
                onPointerDown={(event) => startDragNode(event, node.id)}
                style={{ transition: 'opacity 0.2s' }}
                opacity={nodeOpacity}
              >
                <circle
                  r={30}
                  fill={node.color}
                  opacity={isPrimary ? 0.4 : 0}
                  style={{ transition: 'opacity 0.2s' }}
                />
                <circle
                  r={node.radius}
                  fill={node.color}
                  stroke={isDirectMatch ? '#fff' : '#0a0a0a'}
                  strokeWidth={isDirectMatch ? 3 : 2}
                  filter={isPrimary ? `url(#${glowFilterId})` : undefined}
                  style={{ transition: 'filter 0.2s, stroke 0.2s, stroke-width 0.2s' }}
                />
                <text
                  y={node.radius + 16}
                  textAnchor="middle"
                  className="text-[10px]"
                  style={{
                    fill: '#9ca3af',
                    fontWeight: 500,
                  }}
                >
                  {node.label}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      <div
        className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative flex items-center">
          <Search className="absolute left-3 size-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-64 border-none bg-[var(--rowboat-raised)] pl-9 pr-20 shadow-[var(--rowboat-shadow-soft)]"
          />
          <div className="absolute right-3 flex items-center gap-2">
            {searchMatchingNodes && (
              <span className="text-xs text-muted-foreground">
                {searchMatchingNodes.directMatches.size}
              </span>
            )}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
