import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Brain, Check, ChevronDown } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useModels, type ModelPickerGroup, type ModelRef, type ModelSelection } from '@/hooks/use-models'
import { cn } from '@/lib/utils'

export type { ModelRef, ModelSelection } from '@/hooks/use-models'

export type ReasoningEffortLevel = 'low' | 'medium' | 'high'

const TOOLTIP_DELAY_MS = 1000

export const providerDisplayNames: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  aigateway: 'AI Gateway',
  'openai-compatible': 'OpenAI-Compatible',
  rowboat: 'Rowboat',
  // Matches what other subscription clients call this provider; the auth
  // itself is "Sign in with ChatGPT" (Plus/Pro subscription).
  codex: 'OpenAI Codex',
}

// '' = auto (provider default). Ordered as shown in the picker.
// `short` is the compact form shown inline after the model name (trigger
// pill and list rows), hermes-style ("Fable 5 Med"); Auto renders nothing.
const REASONING_EFFORT_OPTIONS: Array<{ value: '' | ReasoningEffortLevel; label: string; short: string; hint: string }> = [
  { value: '', label: 'Auto', short: '', hint: 'Provider default' },
  { value: 'low', label: 'Fast', short: 'Fast', hint: 'Minimal thinking' },
  { value: 'medium', label: 'Balanced', short: 'Bal', hint: 'Moderate thinking' },
  { value: 'high', label: 'Thorough', short: 'Thoro', hint: 'Deep thinking, costs more' },
]

// Effort submenu panel geometry (px). Width matches hermes' w-52 submenu;
// the height estimate only feeds the viewport clamp, not layout.
const SUB_PANEL_WIDTH = 208
const SUB_PANEL_GAP = 4
const SUB_PANEL_EST_HEIGHT = 180
// How long the grace triangle stays armed after leaving the anchor row.
// Radix menus keep theirs alive while the pointer stays inside the polygon;
// a generous expiry approximates that without per-move re-arming.
const SUB_GRACE_MS = 500

interface Point { x: number; y: number }

// Standard sign-based point-in-triangle test.
function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const sign = (p1: Point, p2: Point, p3: Point) =>
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  const d1 = sign(p, a, b)
  const d2 = sign(p, b, c)
  const d3 = sign(p, c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function getModelDisplayName(model: string) {
  return model.split('/').pop() || model
}

// The standardized model picker (model-selection consolidation), mounted
// everywhere models are chosen — the composer pill, every settings field,
// per-task overrides, and the coding-agent restricted lists. One controlled
// value/onChange contract with per-surface modes layered on as optional
// props.
//
// The dropdown is a Popover + cmdk Command. With the search empty and more
// than one provider connected, it browses as a SPLIT VIEW: providers on the
// left (the assistant's provider pre-selected), the chosen provider's models
// on the right — ←/→ switches provider, ↑/↓ navigates models. Typing
// collapses to one flat list filtered across ALL providers (model ids and
// provider names both match). Scoped/static pickers stay flat.
export interface ModelSelectorProps {
  /**
   * Current selection — model AND effort as one value (effort absent =
   * Auto); null follows the app default / the sentinel.
   */
  value: ModelSelection | null
  /**
   * Fires with the complete selection on every commit: a plain row click
   * carries no effort (Auto), an effort-submenu click carries its level,
   * and on a locked chat an effort pick re-fires the locked ref with the
   * new effort. null only ever fires when a sentinel row is picked.
   */
  onChange: (value: ModelSelection | null) => void
  /**
   * Pinned top entry ("Same as Assistant") that selects null. When set, a
   * null value renders this label instead of the app default model.
   */
  defaultOption?: { label: string }
  /**
   * Inheritance flavor of defaultOption for per-task overrides: same
   * sentinel row and null semantics, but null means "inherit at runtime"
   * and the trigger renders the label muted, so an un-overridden field
   * reads like a placeholder. Mutually exclusive with defaultOption
   * (defaultOption wins).
   */
  inheritDefault?: { label: string }
  /**
   * 'pill' is the composer's compact rounded trigger; 'field' is a
   * full-width bordered Select-style trigger for forms.
   */
  variant?: 'pill' | 'field'
  /**
   * Restrict the picker to one connected provider's group.
   */
  providerFilter?: string
  /**
   * When the search text matches no rows, offer a `Use "<text>"` row that
   * selects the typed id — arbitrary ids for ollama / openai-compatible.
   * With providerFilter the typed id attaches to that provider. Without it,
   * "provider/model" splits on the FIRST slash (so an OpenRouter id must be
   * typed provider-qualified: "openrouter/meituan/longcat-2.0"); text with
   * no slash attaches to the global default's provider.
   */
  allowCustom?: boolean
  /**
   * Caller-supplied restricted list (e.g. a coding agent's own model
   * options): the picker renders ONLY these rows plus the defaultOption
   * sentinel — no catalog groups. Entries are opaque engine ids, not
   * provider/model pairs, so the selected ref is {provider: '', model: id}.
   * Search filters on label and id; rows whose label differs from their id
   * show the id as secondary text (labels can collide, e.g. Claude lists
   * both the 'opus' alias and the concrete id as "Opus").
   */
  staticOptions?: Array<{ id: string; label?: string }>
  /** Optional title attribute for the trigger button (header tooltips). */
  triggerTitle?: string
  /** Frozen selection: renders a static label + tooltip instead of the dropdown. */
  lockedModel?: ModelRef | null
  /**
   * Enables the effort submenu: hovering a reasoning-capable model row
   * opens a side panel (hermes-style) listing effort levels — clicking one
   * commits that model AND effort in one shot; clicking the row itself
   * commits the model with effort Auto. The committed pair arrives via
   * onChange. Works in both pill and field variants; on locked chats the
   * frozen model still allows effort-only picks.
   */
  effortSelectable?: boolean
}

// cmdk item value for the defaultOption sentinel row. Never a valid model
// key (real keys always contain "provider/").
const DEFAULT_OPTION_KEY = '__default__'

// Un-scoped custom entries can't know their provider, so the rule is:
// scoped → the scoped provider; "provider/model" → split on the FIRST
// slash; no slash → the global default's provider (matching how the
// runtime pairs a provider-less model override).
function parseCustomModel(text: string, providerFilter: string | undefined, defaultModel: ModelRef | null): ModelRef {
  if (providerFilter) return { provider: providerFilter, model: text }
  const slash = text.indexOf('/')
  if (slash > 0 && slash < text.length - 1) {
    return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
  }
  return { provider: defaultModel?.provider ?? '', model: text }
}

// Adapters for surfaces that persist a per-item override as optional
// strings (BackgroundTask.model/provider/effort, LiveNote equivalents)
// where unset = inherit the global default. A model without a provider is
// legal (the runtime pairs it with the default provider), so '' round-trips
// to undefined and a null ref clears every field — effort included, since
// model and effort are one explicit pair.
export function modelOverrideToRef(
  model: string | undefined,
  provider: string | undefined,
  effort?: ReasoningEffortLevel,
): ModelSelection | null {
  return model ? { provider: provider ?? '', model, ...(effort ? { effort } : {}) } : null
}

export function refToModelOverride(
  selection: ModelSelection | null,
): { model: string | undefined; provider: string | undefined; effort: ReasoningEffortLevel | undefined } {
  return {
    model: selection?.model || undefined,
    provider: selection?.provider || undefined,
    effort: selection?.model ? selection.effort : undefined,
  }
}

export function ModelSelector({
  value,
  onChange,
  defaultOption,
  inheritDefault,
  variant = 'pill',
  providerFilter,
  allowCustom = false,
  staticOptions,
  triggerTitle,
  lockedModel = null,
  effortSelectable = false,
}: ModelSelectorProps) {
  const { groups: allGroups, reasoningByKey, defaultModel, catalogByProvider, refresh } = useModels()

  // inheritDefault is defaultOption with placeholder styling — one sentinel
  // code path, not two.
  const sentinel = defaultOption ?? inheritDefault
  const sentinelMuted = !defaultOption && Boolean(inheritDefault)

  const groups = useMemo<ModelPickerGroup[]>(() => {
    if (!providerFilter) return allGroups
    const scoped = allGroups.filter((g) => g.id === providerFilter)
    if (scoped.length > 0) return scoped
    const catalogModels = catalogByProvider[providerFilter] || []
    return catalogModels.length > 0
      ? [{ id: providerFilter, flavor: providerFilter, models: catalogModels, status: 'ok' }]
      : []
  }, [allGroups, providerFilter, catalogByProvider])

  const [open, setOpen] = useState(false)
  // cmdk's highlighted-item value, controlled: when the split view swaps the
  // provider column, the previous group's items unmount and cmdk's internal
  // highlight is left pointing at a value with no item — ↵ becomes a no-op.
  // Driving the value ourselves re-anchors the highlight on the new group.
  const [commandValue, setCommandValue] = useState('')
  // Search text; case-insensitive substring test on the model id AND the
  // provider name — typing "rowboat" surfaces the whole Rowboat group.
  const [query, setQuery] = useState('')
  const queryValue = query.trim().toLowerCase()
  const groupMatchesFilter = useCallback((g: ModelPickerGroup) =>
    (providerDisplayNames[g.flavor] || g.flavor).toLowerCase().includes(queryValue)
    || g.id.toLowerCase().includes(queryValue), [queryValue])

  // Split view only where browsing across providers is meaningful.
  const splitMode = !staticOptions && !providerFilter && !queryValue && groups.length > 1
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null)
  const activeGroup = splitMode
    ? (groups.find((g) => g.id === activeProviderId) ?? groups[0])
    : null

  // Hover-opened effort submenu (hermes-style): one floating panel anchored
  // to the hovered model row, portalled to <body> because PopoverContent is
  // overflow-hidden. Position is captured from the row's rect at open time;
  // list scroll and query changes close it rather than tracking movement.
  const [sub, setSub] = useState<{ key: string; provider: string; model: string; top: number; left: number } | null>(null)
  const subPanelRef = useRef<HTMLDivElement | null>(null)
  const subCloseTimer = useRef<number | null>(null)
  const cancelSubClose = useCallback(() => {
    if (subCloseTimer.current !== null) {
      window.clearTimeout(subCloseTimer.current)
      subCloseTimer.current = null
    }
  }, [])
  // Delayed close so the pointer can travel row → panel without flicker
  // (generous enough to cover a slow diagonal through the grace triangle).
  const scheduleSubClose = useCallback(() => {
    cancelSubClose()
    subCloseTimer.current = window.setTimeout(() => setSub(null), 300)
  }, [cancelSubClose])
  useEffect(() => cancelSubClose, [cancelSubClose])
  // Grace-intent triangle (what Radix DropdownMenuSub does natively): when
  // the pointer leaves the anchor row heading toward its open panel, the
  // triangle between the exit point and the panel's near edge is a dead
  // zone — rows crossed inside it neither re-anchor nor close the panel.
  // Without this, a diagonal move toward the panel sweeps the submenu onto
  // the row below (the bug hermes never sees because Radix handles it).
  const graceRef = useRef<{ apex: Point; top: Point; bottom: Point; expires: number } | null>(null)
  const inGraceArea = useCallback((x: number, y: number) => {
    const g = graceRef.current
    if (!g) return false
    if (performance.now() > g.expires) {
      graceRef.current = null
      return false
    }
    return pointInTriangle({ x, y }, g.apex, g.top, g.bottom)
  }, [])
  const armGrace = useCallback((x: number, y: number) => {
    const rect = subPanelRef.current?.getBoundingClientRect()
    if (!rect) return
    // The panel edge facing the rows, padded a little vertically so the
    // triangle isn't razor-thin at the corners.
    const nearX = x <= rect.left ? rect.left : rect.right
    graceRef.current = {
      apex: { x, y },
      top: { x: nearX, y: rect.top - 8 },
      bottom: { x: nearX, y: rect.bottom + 8 },
      expires: performance.now() + SUB_GRACE_MS,
    }
  }, [])
  const openSub = useCallback((row: HTMLElement, provider: string, model: string) => {
    cancelSubClose()
    const rect = row.getBoundingClientRect()
    // Right of the row, flipped left when the viewport edge is close; top
    // clamped so the panel never renders off-screen.
    const left = rect.right + SUB_PANEL_GAP + SUB_PANEL_WIDTH > window.innerWidth
      ? rect.left - SUB_PANEL_WIDTH - SUB_PANEL_GAP
      : rect.right + SUB_PANEL_GAP
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - SUB_PANEL_EST_HEIGHT - 8))
    setSub({ key: `${provider}/${model}`, provider, model, top, left })
  }, [cancelSubClose])

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    setSub(null)
    if (next) {
      // Per-opening state: fresh search, provider column on the selection's
      // (else the assistant's) provider — groups[0] is already the
      // assistant's group by store ordering. Empty commandValue lets cmdk
      // highlight the first rendered item itself.
      setQuery('')
      setCommandValue('')
      setActiveProviderId(value?.provider ?? defaultModel?.provider ?? null)
    }
  }, [value, defaultModel])

  // Switch the split view's provider column and re-anchor the keyboard
  // highlight on the new group's first row (see commandValue above).
  const switchProvider = useCallback((g: ModelPickerGroup) => {
    setSub(null)
    setActiveProviderId(g.id)
    setCommandValue(
      g.models.length > 0
        ? `${g.id}/${g.models[0]}`
        : g.status === 'error'
          ? `__retry__:${g.id}`
          : sentinel ? DEFAULT_OPTION_KEY : '',
    )
  }, [sentinel])

  // The effective default always renders even when no group carries it (the
  // provider's list failed, or its provider was removed from config) — the
  // picker must never be missing the model that actually runs. A
  // provider-scoped picker only shows it when it belongs to that provider.
  const standaloneDefault = useMemo<ModelRef | null>(() => {
    if (!defaultModel) return null
    if (providerFilter && defaultModel.provider !== providerFilter) return null
    const covered = groups.some((g) =>
      g.id === defaultModel.provider && g.models.includes(defaultModel.model))
    return covered ? null : defaultModel
  }, [groups, defaultModel, providerFilter])

  const standaloneVisible = standaloneDefault !== null &&
    (!queryValue || standaloneDefault.model.toLowerCase().includes(queryValue))
  // Static mode replaces all store-driven rows with the caller's list.
  const staticVisible = useMemo(() => {
    if (!staticOptions) return null
    if (!queryValue) return staticOptions
    return staticOptions.filter((o) =>
      (o.label ?? o.id).toLowerCase().includes(queryValue) || o.id.toLowerCase().includes(queryValue))
  }, [staticOptions, queryValue])
  const staticLabelFor = (id: string) => staticOptions?.find((o) => o.id === id)?.label ?? id
  // Nothing matches anywhere → "No models match".
  const anyModelRowVisible = staticVisible
    ? staticVisible.length > 0
    : standaloneVisible
      || groups.some((g) =>
        groupMatchesFilter(g) ? g.models.length > 0
          : g.models.some((m) => m.toLowerCase().includes(queryValue)))

  // The cmdk value of the current selection, for check indicators.
  const selectedKey = value
    ? (staticOptions ? value.model : `${value.provider}/${value.model}`)
    : sentinel
      ? DEFAULT_OPTION_KEY
      : (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')

  // Model and effort commit together as ONE value: a plain row click means
  // Auto (no effort key), an effort-submenu click carries its level — so
  // switching models never drags a stale effort along.
  const select = useCallback((ref: ModelRef | null, effortLevel: '' | ReasoningEffortLevel = '') => {
    if (lockedModel) return
    setSub(null)
    setOpen(false)
    onChange(ref ? { ...ref, ...(effortLevel ? { effort: effortLevel } : {}) } : null)
  }, [lockedModel, onChange])

  // Reasoning effort applies to the model the next message will actually use:
  // the frozen model when locked, else the picker selection, else the app
  // default. Only known-reasoning models show the control.
  const effectiveModelKey = lockedModel
    ? `${lockedModel.provider}/${lockedModel.model}`
    : (value ? `${value.provider}/${value.model}` : '')
      || (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')
  const reasoningAvailable = reasoningByKey[effectiveModelKey] === true
  const effortControl = reasoningAvailable && effortSelectable
  // The effort shown on the trigger and ticked in panels — always the
  // value's own effort. A stale effort on a non-reasoning model is not
  // auto-cleared here: the pair semantics make it unreachable via the UI,
  // and the runtime's capability mapping fails closed anyway.
  const shownEffort: '' | ReasoningEffortLevel = value?.effort ?? ''

  // Effort radio row for the locked-model popover only (model frozen, effort
  // still adjustable): commits the locked ref with the new effort as one
  // selection. The main picker uses the per-row hover submenu instead.
  const renderEffortFooter = () => effortControl && lockedModel && (
    <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Brain className="h-3 w-3 shrink-0" />
        Reasoning
      </span>
      <div className="flex items-center gap-0.5">
        {REASONING_EFFORT_OPTIONS.map((option) => (
          <button
            key={option.value || 'auto'}
            type="button"
            title={option.hint}
            onClick={() => onChange({
              provider: lockedModel.provider,
              model: lockedModel.model,
              ...(option.value ? { effort: option.value } : {}),
            })}
            className={cn(
              'rounded-full px-2 py-0.5 text-xs transition-colors',
              shownEffort === option.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  // Non-auto effort surfaces on the trigger the same way the list rows show
  // it: model name followed by the grayed short form ("claude-fable-5 Thoro").
  const renderEffortBadge = () => effortControl && shownEffort !== '' && (
    <span className="shrink-0 text-xs text-muted-foreground">
      {REASONING_EFFORT_OPTIONS.find((o) => o.value === shownEffort)?.short}
    </span>
  )

  const renderModelItem = (providerId: string, model: string, secondary?: string) => {
    const key = `${providerId}/${model}`
    // Hovering a reasoning-capable row opens the effort submenu (hermes
    // pattern); hovering any other row schedules it closed so the panel
    // always tracks the row under the pointer. Both re-check on every move
    // (not just enter) so a pointer that parks on a row past the grace
    // expiry still takes effect without needing to re-enter the row.
    const canEffort = effortSelectable && reasoningByKey[key] === true
    const isSelected = selectedKey === key
    const onHover = canEffort
      ? (e: ReactMouseEvent<HTMLDivElement>) => {
          if (inGraceArea(e.clientX, e.clientY)) return
          graceRef.current = null
          if (sub?.key === key) {
            cancelSubClose()
            return
          }
          openSub(e.currentTarget, providerId, model)
        }
      : (e: ReactMouseEvent<HTMLDivElement>) => {
          if (inGraceArea(e.clientX, e.clientY)) return
          scheduleSubClose()
        }
    return (
      <CommandItem
        key={key}
        value={key}
        onSelect={() => select({ provider: providerId, model })}
        onMouseEnter={onHover}
        onMouseMove={onHover}
        onMouseLeave={canEffort
          ? (e) => {
              // Arm the dead zone toward the open panel, then let the close
              // timer race the pointer's travel (panel entry cancels it).
              if (sub?.key === key) armGrace(e.clientX, e.clientY)
              scheduleSubClose()
            }
          : undefined}
      >
        <Check className={cn('size-3.5 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
        <span className="truncate">{model}</span>
        {isSelected && canEffort && shownEffort !== '' && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {REASONING_EFFORT_OPTIONS.find((o) => o.value === shownEffort)?.short}
          </span>
        )}
        {secondary && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{secondary}</span>}
      </CommandItem>
    )
  }

  // The floating effort panel. Portalled to <body> (PopoverContent clips);
  // the popover is modal, so pointer-events must be re-enabled explicitly
  // and PopoverContent's onInteractOutside must ignore clicks landing here.
  const renderEffortSubPanel = () => {
    if (!open || !sub) return null
    // The panel's ticked level: the value's own effort for the currently
    // selected model, and Auto — the level a plain row click commits — for
    // any other row, mirroring hermes' per-model default pre-selection.
    const subEffort = selectedKey === sub.key ? shownEffort : ''
    return createPortal(
      <div
        ref={subPanelRef}
        style={{ position: 'fixed', top: sub.top, left: sub.left, width: SUB_PANEL_WIDTH, pointerEvents: 'auto' }}
        className="z-50 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        onMouseEnter={() => {
          graceRef.current = null
          cancelSubClose()
        }}
        onMouseLeave={scheduleSubClose}
      >
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Effort
        </div>
        {REASONING_EFFORT_OPTIONS.map((option) => (
          <button
            key={option.value || 'auto'}
            type="button"
            title={option.hint}
            onClick={() => select({ provider: sub.provider, model: sub.model }, option.value)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {subEffort === option.value && (
              <Check className="size-3.5 shrink-0" />
            )}
          </button>
        ))}
      </div>,
      document.body,
    )
  }

  const renderSentinelItem = () => sentinel && (
    <CommandItem value={DEFAULT_OPTION_KEY} onSelect={() => select(null)}>
      <Check className={cn('size-3.5 shrink-0', selectedKey === DEFAULT_OPTION_KEY ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{sentinel.label}</span>
    </CommandItem>
  )

  const renderErrorItem = (g: ModelPickerGroup) => (
    <CommandItem
      key={`__retry__:${g.id}`}
      value={`__retry__:${g.id}`}
      // Retry refreshes in place — the popover stays open and the group
      // re-renders when the store updates.
      onSelect={() => refresh(g.id)}
      className="text-xs"
    >
      <span className="truncate text-destructive">{g.error || 'Failed to load models'}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">Retry</span>
    </CommandItem>
  )

  if (lockedModel) {
    // The model is frozen but effort (per-message) is still adjustable: the
    // locked label becomes a popover holding just the effort row. Without an
    // effort control it stays the old static label + tooltip.
    return effortControl ? (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="min-w-0 truncate text-foreground/80">{getModelDisplayName(lockedModel.model)}</span>
            {renderEffortBadge()}
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0 overflow-hidden">
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {providerDisplayNames[lockedModel.provider] || lockedModel.provider} — model is fixed for this chat
          </div>
          {renderEffortFooter()}
        </PopoverContent>
      </Popover>
    ) : (
      <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
        <TooltipTrigger asChild>
          <span className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{getModelDisplayName(lockedModel.model)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {providerDisplayNames[lockedModel.provider] || lockedModel.provider} — fixed for this chat
        </TooltipContent>
      </Tooltip>
    )
  }

  // modal: the settings Dialog's scroll-lock cancels wheel events over
  // content portalled outside its subtree — a modal popover brings its
  // own lock layer that permits scrolling within (Radix's supported
  // fix for popover-inside-dialog; matches the old DropdownMenu's
  // modality). Keyboard scrolling was never affected (cmdk uses
  // programmatic scrollIntoView).
  return (
        <Popover open={open} onOpenChange={handleOpenChange} modal>
          <PopoverTrigger asChild>
            {variant === 'field' ? (
              // Styled after ui/select's SelectTrigger so it sits naturally
              // in forms next to real Select fields.
              <button
                type="button"
                title={triggerTitle}
                className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn('truncate', !value && sentinelMuted && 'text-muted-foreground')}>
                    {value
                      ? (staticOptions ? staticLabelFor(value.model) : value.model)
                      : (sentinel?.label || defaultModel?.model || 'Select a model')}
                  </span>
                  {renderEffortBadge()}
                  {value && !providerFilter && !staticOptions && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {providerDisplayNames[value.provider] || value.provider}
                    </span>
                  )}
                </span>
                <ChevronDown className="size-4 shrink-0 opacity-50" />
              </button>
            ) : (
              <button
                type="button"
                title={triggerTitle}
                className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {/* Name in foreground vs muted effort — same hierarchy as the
                    list rows, else the two read as one undifferentiated label. */}
                <span className="min-w-0 truncate text-foreground/80">
                  {staticOptions
                    ? (value ? staticLabelFor(value.model) : (sentinel?.label ?? 'Model'))
                    : getModelDisplayName(value?.model || defaultModel?.model || 'Model')}
                </span>
                {renderEffortBadge()}
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            )}
          </PopoverTrigger>
          <PopoverContent
            align={variant === 'field' ? 'start' : 'end'}
            // The effort panel lives outside the popover subtree (body
            // portal), so Radix would treat clicks on it as outside
            // interactions and dismiss the picker mid-click.
            onInteractOutside={(e) => {
              if (subPanelRef.current && e.target instanceof Node && subPanelRef.current.contains(e.target)) {
                e.preventDefault()
              }
            }}
            className={cn(
              'p-0 overflow-hidden',
              splitMode
                ? 'w-[480px]'
                : variant === 'field'
                  ? 'w-[var(--radix-popover-trigger-width)] min-w-[300px]'
                  : 'w-[320px]',
            )}
          >
            {!staticOptions && groups.length === 0 && !standaloneDefault && !sentinel && !allowCustom ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Connect a provider in Settings</div>
            ) : (
              <Command
                // Filtering is ours (provider-name matching, the custom-id
                // escape hatch, split-mode layout) — cmdk only does keyboard
                // navigation and selection over what we render, with the
                // highlighted value controlled (see commandValue).
                shouldFilter={false}
                value={commandValue}
                onValueChange={setCommandValue}
                onKeyDown={(e) => {
                  // Split mode: ←/→ cycles the provider column (tabs
                  // semantics); ↑/↓ stays on the model list via cmdk.
                  if (!splitMode || groups.length === 0) return
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  const index = groups.findIndex((g) => g.id === (activeGroup?.id ?? ''))
                  const next = e.key === 'ArrowRight'
                    ? (index + 1) % groups.length
                    : (index - 1 + groups.length) % groups.length
                  switchProvider(groups[next])
                }}
              >
                <CommandInput
                  autoFocus
                  value={query}
                  onValueChange={(v) => {
                    setQuery(v)
                    // Typing refilters the rows the panel was anchored to.
                    setSub(null)
                  }}
                  placeholder="Search models and providers…"
                />
                {splitMode && activeGroup ? (
                  <div className="flex">
                    {/* Provider column — tab-like: click or ←/→. */}
                    <div className="w-40 shrink-0 border-r max-h-80 overflow-y-auto p-1" role="tablist" aria-label="Providers">
                      {groups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          role="tab"
                          aria-selected={g.id === activeGroup.id}
                          tabIndex={-1}
                          onClick={() => switchProvider(g)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                            g.id === activeGroup.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{providerDisplayNames[g.flavor] || g.flavor}</span>
                          {g.status === 'error' ? (
                            <span className="size-2 shrink-0 rounded-full bg-destructive" />
                          ) : (
                            <span className="shrink-0 text-[10px] text-muted-foreground">{g.models.length}</span>
                          )}
                        </button>
                      ))}
                    </div>
                    <CommandList className="max-h-80 flex-1" onScroll={() => setSub(null)}>
                      <CommandGroup>
                        {renderSentinelItem()}
                        {standaloneDefault && standaloneDefault.provider === activeGroup.id &&
                          renderModelItem(standaloneDefault.provider, standaloneDefault.model)}
                        {activeGroup.models.map((m) => renderModelItem(activeGroup.id, m))}
                        {activeGroup.status === 'error' && renderErrorItem(activeGroup)}
                        {activeGroup.status === 'ok' && activeGroup.models.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">No models reported</div>
                        )}
                      </CommandGroup>
                    </CommandList>
                  </div>
                ) : (
                  <CommandList className="max-h-80" onScroll={() => setSub(null)}>
                    {sentinel && !queryValue && (
                      <CommandGroup>{renderSentinelItem()}</CommandGroup>
                    )}
                    {staticVisible && staticVisible.length > 0 && (
                      <CommandGroup>
                        {staticVisible.map((o) => (
                          <CommandItem key={o.id} value={o.id} onSelect={() => select({ provider: '', model: o.id })}>
                            <Check className={cn('size-3.5 shrink-0', selectedKey === o.id ? 'opacity-100' : 'opacity-0')} />
                            <span className="truncate">{o.label ?? o.id}</span>
                            {o.label && o.label !== o.id && (
                              <span className="ml-2 shrink-0 text-xs text-muted-foreground">{o.id}</span>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                    {!staticOptions && standaloneDefault && standaloneVisible && (
                      <CommandGroup>
                        {renderModelItem(
                          standaloneDefault.provider,
                          standaloneDefault.model,
                          providerDisplayNames[standaloneDefault.provider] || standaloneDefault.provider,
                        )}
                      </CommandGroup>
                    )}
                    {!staticOptions && groups.map((g) => {
                      // A provider-name match shows the whole group.
                      const visibleModels = queryValue && !groupMatchesFilter(g)
                        ? g.models.filter((m) => m.toLowerCase().includes(queryValue))
                        : g.models
                      // Error rows are status, not models: they render (with
                      // the header) regardless of the filter and don't count
                      // toward "No models match".
                      const showError = g.status === 'error'
                      if (visibleModels.length === 0 && !showError) return null
                      return (
                        <CommandGroup key={g.id} heading={providerDisplayNames[g.flavor] || g.flavor}>
                          {visibleModels.map((m) => renderModelItem(g.id, m))}
                          {showError && renderErrorItem(g)}
                        </CommandGroup>
                      )
                    })}
                    {queryValue && !anyModelRowVisible && (
                      allowCustom ? (
                        // Escape hatch for ids the lists don't carry (local
                        // servers, brand-new models): select exactly what was
                        // typed.
                        <CommandGroup>
                          <CommandItem
                            value="__custom__"
                            onSelect={() => select(parseCustomModel(query.trim(), providerFilter, defaultModel))}
                          >
                            <span className="truncate">Use &quot;{query.trim()}&quot;</span>
                          </CommandItem>
                        </CommandGroup>
                      ) : (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No models match</div>
                      )
                    )}
                  </CommandList>
                )}
              </Command>
            )}
          </PopoverContent>
          {renderEffortSubPanel()}
        </Popover>
  )
}
