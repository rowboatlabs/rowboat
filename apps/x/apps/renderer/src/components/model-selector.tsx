import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, LoaderIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useModels, type ModelPickerGroup, type ModelRef } from '@/hooks/use-models'
import { useProviderModels, type ProviderModelsFlavor } from '@/hooks/use-provider-models'
import { cn } from '@/lib/utils'

export type { ModelRef } from '@/hooks/use-models'

export type ReasoningEffortLevel = 'low' | 'medium' | 'high'

const TOOLTIP_DELAY_MS = 1000

const providerDisplayNames: Record<string, string> = {
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
const REASONING_EFFORT_OPTIONS: Array<{ value: '' | ReasoningEffortLevel; label: string; hint: string }> = [
  { value: '', label: 'Auto', hint: 'Provider default' },
  { value: 'low', label: 'Fast', hint: 'Minimal thinking' },
  { value: 'medium', label: 'Balanced', hint: 'Moderate thinking' },
  { value: 'high', label: 'Thorough', hint: 'Deep thinking, costs more' },
]

function getModelDisplayName(model: string) {
  return model.split('/').pop() || model
}

// Rendered inside the dropdown's radio group: each live provider fetches its
// own list, so groups load and fail independently. Pinned models (the saved
// default / app default) render first — the model that actually runs is
// always pickable even while the fetch is pending or failed. Live-fetched
// ids carry no reasoning metadata, so the effort control stays hidden for
// them (reasoningByKey lookup misses default to off).
//
// The group owns its header so it can hide itself when the search filter
// matches none of its rows. Loading/error rows are status, not models — they
// render (with the header) regardless of the filter, and don't count toward
// the parent's "No models match" check (which is what gets reported up).
function LiveProviderGroupItems({ group, label, pinnedModels, filter, onModelRowsChange }: {
  group: Extract<ModelPickerGroup, { kind: 'live' }>
  label: string
  pinnedModels: string[]
  filter: string
  onModelRowsChange: (flavor: string, hasModelRows: boolean) => void
}) {
  const { status, models, error, refetch } = useProviderModels({
    flavor: group.flavor,
    apiKey: group.apiKey,
    baseURL: group.baseURL,
  })
  const items = [...pinnedModels, ...models.filter((m) => !pinnedModels.includes(m))]
  const visible = filter ? items.filter((m) => m.toLowerCase().includes(filter)) : items
  const showStatus = status === 'loading' || status === 'error'
  const hasModelRows = visible.length > 0
  useEffect(() => {
    onModelRowsChange(group.flavor, hasModelRows)
  }, [group.flavor, hasModelRows, onModelRowsChange])
  if (!hasModelRows && !showStatus) return null
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
      {visible.map((m) => {
        const key = `${group.flavor}/${m}`
        return (
          <DropdownMenuRadioItem key={key} value={key}>
            <span className="truncate">{m}</span>
          </DropdownMenuRadioItem>
        )
      })}
      {status === 'loading' && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <LoaderIcon className="h-3 w-3 animate-spin" />
          Loading models…
        </div>
      )}
      {status === 'error' && (
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            refetch()
          }}
          className="text-xs"
        >
          <span className="truncate text-destructive">{error || 'Failed to load models'}</span>
          <span className="ml-auto shrink-0 text-muted-foreground">Retry</span>
        </DropdownMenuItem>
      )}
    </>
  )
}

// The standardized model picker (model-selection consolidation), mounted
// everywhere models are chosen. One controlled value/onChange contract with
// per-surface modes layered on as optional props: the composer's full
// catalog picker (provider groups, live fetches, search, reasoning effort),
// settings' default sentinel / field trigger / provider scoping / typed-id
// escape hatch, per-task "(global default)" inheritance, and caller-supplied
// restricted lists (coding-agent options).
export interface ModelSelectorProps {
  /** Current selection; null follows the app default / the sentinel. */
  value: ModelRef | null
  /** null only ever fires when defaultOption is set (sentinel picked). */
  onChange: (value: ModelRef | null) => void
  /**
   * Pinned top entry ("Rowboat default", "Same as assistant") that selects
   * null. When set, a null value renders this label instead of the app
   * default model.
   */
  defaultOption?: { label: string }
  /**
   * Inheritance flavor of defaultOption for per-task overrides
   * ("(global default)"): same sentinel row and null semantics, but null
   * means "inherit the global default at runtime" and the trigger renders
   * the label muted, so an un-overridden field reads like a placeholder.
   * Mutually exclusive with defaultOption (defaultOption wins).
   */
  inheritDefault?: { label: string }
  /**
   * 'pill' is the composer's compact rounded trigger; 'field' is a
   * full-width bordered Select-style trigger for forms.
   */
  variant?: 'pill' | 'field'
  /**
   * Restrict the picker to one provider's group (catalog or live). Providers
   * not configured in models.json fall back to their static models:list
   * catalog so a provider mid-setup still lists models.
   */
  providerFilter?: string
  /**
   * Live-fetch credentials for a provider being configured right now (typed
   * but possibly unsaved). Store groups only exist for providers saved in
   * models.json and the catalog fallback only covers openai/anthropic/
   * google — this synthesizes the scoped live group from the form's current
   * inputs instead (and wins over a saved group, whose stored key may be
   * stale). Requires providerFilter set to the same flavor; ignored until
   * some credential is typed. useProviderModels debounces + caches, so
   * keystrokes don't spray fetches.
   */
  liveCredentials?: { flavor: ProviderModelsFlavor; apiKey: string; baseURL: string }
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
   * sentinel — no catalog groups, no live fetches. Entries are opaque
   * engine ids, not provider/model pairs, so the selected ref is
   * {provider: '', model: id} — the id travels in .model and provider is
   * meaningless. Search filters on label and id; rows whose label differs
   * from their id show the id as secondary text (labels can collide, e.g.
   * Claude lists both the 'opus' alias and the concrete id as "Opus").
   */
  staticOptions?: Array<{ id: string; label?: string }>
  /** Optional title attribute for the trigger button (header tooltips). */
  triggerTitle?: string
  /** Frozen selection: renders a static label + tooltip instead of the dropdown. */
  lockedModel?: ModelRef | null
  /**
   * Reasoning effort ('' = auto). The control renders only for models the
   * catalog flags as reasoning-capable. When the effective model loses
   * reasoning support, '' is reported up so a stale effort never outlives
   * its model. Omit onEffortChange to hide the effort control entirely.
   */
  effort?: '' | ReasoningEffortLevel
  onEffortChange?: (effort: '' | ReasoningEffortLevel) => void
}

// Radio value for the defaultOption sentinel row. Never a valid model key
// (real keys always contain "provider/").
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

// Adapters for surfaces that persist a per-item override as two optional
// strings (BackgroundTask.model/provider, LiveNote.model/provider) where
// unset = inherit the global default. A model without a provider is legal
// (the runtime pairs it with the default provider), so '' round-trips to
// undefined and a null ref clears both fields.
export function modelOverrideToRef(model: string | undefined, provider: string | undefined): ModelRef | null {
  return model ? { provider: provider ?? '', model } : null
}

export function refToModelOverride(ref: ModelRef | null): { model: string | undefined; provider: string | undefined } {
  return { model: ref?.model || undefined, provider: ref?.provider || undefined }
}

export function ModelSelector({
  value,
  onChange,
  defaultOption,
  inheritDefault,
  variant = 'pill',
  providerFilter,
  liveCredentials,
  allowCustom = false,
  staticOptions,
  triggerTitle,
  lockedModel = null,
  effort = '',
  onEffortChange,
}: ModelSelectorProps) {
  const { groups: allGroups, reasoningByKey, defaultModel, catalogByProvider } = useModels()

  // inheritDefault is defaultOption with placeholder styling — one sentinel
  // code path, not two.
  const sentinel = defaultOption ?? inheritDefault
  const sentinelMuted = !defaultOption && Boolean(inheritDefault)

  const liveFlavor = liveCredentials?.flavor
  const liveApiKey = liveCredentials?.apiKey.trim() ?? ''
  const liveBaseURL = liveCredentials?.baseURL.trim() ?? ''
  const groups = useMemo<ModelPickerGroup[]>(() => {
    if (!providerFilter) return allGroups
    // The form's typed credentials trump anything saved — same "configured"
    // bar as the store (some credential present).
    if (liveFlavor === providerFilter && (liveApiKey || liveBaseURL)) {
      return [{ kind: 'live', flavor: liveFlavor, apiKey: liveApiKey, baseURL: liveBaseURL, savedModel: '' }]
    }
    const scoped = allGroups.filter((g) => g.flavor === providerFilter)
    if (scoped.length > 0) return scoped
    const catalogModels = catalogByProvider[providerFilter] || []
    return catalogModels.length > 0 ? [{ kind: 'catalog', flavor: providerFilter, models: catalogModels }] : []
  }, [allGroups, providerFilter, catalogByProvider, liveFlavor, liveApiKey, liveBaseURL])

  // Search filter for the model dropdown. Reset each time the menu opens;
  // matching is a case-insensitive substring test on the model id. Live
  // groups filter themselves and report whether they still have rows, so the
  // parent can render the global "No models match" row.
  const [modelFilter, setModelFilter] = useState('')
  const modelFilterInputRef = useRef<HTMLInputElement>(null)
  const [liveGroupHasRows, setLiveGroupHasRows] = useState<Record<string, boolean>>({})
  const modelFilterValue = modelFilter.trim().toLowerCase()
  const handleLiveGroupRows = useCallback((flavor: string, hasRows: boolean) => {
    setLiveGroupHasRows((prev) => (prev[flavor] === hasRows ? prev : { ...prev, [flavor]: hasRows }))
  }, [])

  // The effective default always renders even when no group carries it (the
  // gateway list failed, or its provider was removed from config) — the
  // picker must never be missing the model that actually runs. Live groups
  // pin the default themselves, so a flavor match is enough there. A
  // provider-scoped picker only shows it when it belongs to that provider.
  const standaloneDefault = useMemo<ModelRef | null>(() => {
    if (!defaultModel) return null
    if (providerFilter && defaultModel.provider !== providerFilter) return null
    const covered = groups.some((g) =>
      g.flavor === defaultModel.provider &&
      (g.kind === 'live' || g.models.includes(defaultModel.model)))
    return covered ? null : defaultModel
  }, [groups, defaultModel, providerFilter])

  const standaloneVisible = standaloneDefault !== null &&
    (!modelFilterValue || standaloneDefault.model.toLowerCase().includes(modelFilterValue))
  // Static mode replaces all store-driven rows with the caller's list.
  const staticVisible = useMemo(() => {
    if (!staticOptions) return null
    if (!modelFilterValue) return staticOptions
    return staticOptions.filter((o) =>
      (o.label ?? o.id).toLowerCase().includes(modelFilterValue) || o.id.toLowerCase().includes(modelFilterValue))
  }, [staticOptions, modelFilterValue])
  const staticLabelFor = (id: string) => staticOptions?.find((o) => o.id === id)?.label ?? id
  // Nothing matches anywhere → "No models match". Live groups that haven't
  // reported yet (first render after opening) count as having rows so the
  // empty row never flashes.
  const anyModelRowVisible = staticVisible
    ? staticVisible.length > 0
    : standaloneVisible || groups.some((g) =>
      g.kind === 'catalog'
        ? g.models.some((m) => m.toLowerCase().includes(modelFilterValue))
        : liveGroupHasRows[g.flavor] !== false)

  const handleModelChange = useCallback((key: string) => {
    if (lockedModel) return
    if (key === DEFAULT_OPTION_KEY) {
      onChange(null)
      return
    }
    // Static keys are opaque engine ids — no provider/model split (ids may
    // themselves contain slashes).
    if (staticOptions) {
      onChange({ provider: '', model: key })
      return
    }
    const slash = key.indexOf('/')
    if (slash <= 0 || slash === key.length - 1) return
    onChange({ provider: key.slice(0, slash), model: key.slice(slash + 1) })
  }, [lockedModel, onChange, staticOptions])

  // Reasoning effort applies to the model the next message will actually use:
  // the frozen model when locked, else the picker selection, else the app
  // default. Only known-reasoning models show the control.
  const effectiveModelKey = lockedModel
    ? `${lockedModel.provider}/${lockedModel.model}`
    : (value ? `${value.provider}/${value.model}` : '')
      || (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')
  const reasoningAvailable = reasoningByKey[effectiveModelKey] === true

  const handleEffortChange = useCallback((raw: string) => {
    onEffortChange?.(raw === 'low' || raw === 'medium' || raw === 'high' ? raw : '')
  }, [onEffortChange])

  // Switching to a model without reasoning support drops a stale selection —
  // otherwise the next message would carry an effort the model rejects.
  useEffect(() => {
    if (!reasoningAvailable && effort !== '') {
      onEffortChange?.('')
    }
  }, [reasoningAvailable, effort, onEffortChange])

  return (
    <>
      {reasoningAvailable && onEffortChange && (
        <DropdownMenu>
          <Tooltip delayDuration={TOOLTIP_DELAY_MS}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Brain className="h-3 w-3 shrink-0" />
                  {effort !== '' && (
                    <span>{REASONING_EFFORT_OPTIONS.find((o) => o.value === effort)?.label}</span>
                  )}
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Reasoning effort — applies to your next message</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={effort} onValueChange={handleEffortChange}>
              {REASONING_EFFORT_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value || 'auto'} value={option.value}>
                  <span>{option.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{option.hint}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {lockedModel ? (
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
      ) : (
        <DropdownMenu
          onOpenChange={(open) => {
            // The filter is per-opening, never sticky. Focus the search
            // input once the content has mounted and Radix has run its own
            // open-focus (DropdownMenu.Content has no onOpenAutoFocus).
            if (open) {
              setModelFilter('')
              setLiveGroupHasRows({})
              setTimeout(() => modelFilterInputRef.current?.focus(), 0)
            }
          }}
        >
          <DropdownMenuTrigger asChild>
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
                <span className="min-w-0 truncate">
                  {staticOptions
                    ? (value ? staticLabelFor(value.model) : (sentinel?.label ?? 'Model'))
                    : getModelDisplayName(value?.model || defaultModel?.model || 'Model')}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={variant === 'field' ? 'start' : 'end'}
            className={cn('p-0 overflow-hidden', variant === 'field' && 'min-w-[var(--radix-dropdown-menu-trigger-width)]')}
          >
            {!staticOptions && groups.length === 0 && !standaloneDefault && !sentinel && !allowCustom ? (
              <div className="p-1">
                <DropdownMenuItem disabled>Connect a provider in Settings</DropdownMenuItem>
              </div>
            ) : (
              <>
                {/* Fixed search header — lives OUTSIDE the scroll area (the
                    inner div below scrolls), so it's flush at the very top
                    and always visible without any scroll. */}
                <div className="bg-popover p-1">
                  <input
                    ref={modelFilterInputRef}
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    onKeyDown={(e) => {
                      // Printable keys belong to the input, not the menu's
                      // typeahead; arrows and Escape stay with the menu.
                      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') {
                        e.stopPropagation()
                      }
                    }}
                    placeholder="Search models…"
                    className="h-7 w-full rounded-sm border border-input bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="max-h-80 overflow-y-auto p-1 pt-0">
                <DropdownMenuRadioGroup
                  value={
                    value
                      ? (staticOptions ? value.model : `${value.provider}/${value.model}`)
                      : sentinel
                        ? DEFAULT_OPTION_KEY
                        : (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')
                  }
                  onValueChange={handleModelChange}
                >
                  {sentinel && (
                    <DropdownMenuRadioItem value={DEFAULT_OPTION_KEY}>
                      <span className="truncate">{sentinel.label}</span>
                    </DropdownMenuRadioItem>
                  )}
                  {staticVisible?.map((o) => (
                    <DropdownMenuRadioItem key={o.id} value={o.id}>
                      <span className="truncate">{o.label ?? o.id}</span>
                      {o.label && o.label !== o.id && (
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">{o.id}</span>
                      )}
                    </DropdownMenuRadioItem>
                  ))}
                  {!staticOptions && standaloneDefault && standaloneVisible && (
                    <DropdownMenuRadioItem value={`${standaloneDefault.provider}/${standaloneDefault.model}`}>
                      <span className="truncate">{standaloneDefault.model}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {providerDisplayNames[standaloneDefault.provider] || standaloneDefault.provider}
                      </span>
                    </DropdownMenuRadioItem>
                  )}
                  {!staticOptions && groups.map((g) => {
                    const label = providerDisplayNames[g.flavor] || g.flavor
                    if (g.kind === 'live') {
                      // The app default leads its live group; the group's
                      // own saved model follows (both stay pickable through
                      // fetch loading/failure).
                      const pinned: string[] = []
                      if (defaultModel && defaultModel.provider === g.flavor) pinned.push(defaultModel.model)
                      if (g.savedModel && !pinned.includes(g.savedModel)) pinned.push(g.savedModel)
                      return (
                        <LiveProviderGroupItems
                          key={g.flavor}
                          group={g}
                          label={label}
                          pinnedModels={pinned}
                          filter={modelFilterValue}
                          onModelRowsChange={handleLiveGroupRows}
                        />
                      )
                    }
                    const visibleModels = modelFilterValue
                      ? g.models.filter((m) => m.toLowerCase().includes(modelFilterValue))
                      : g.models
                    if (visibleModels.length === 0) return null
                    return (
                      <Fragment key={g.flavor}>
                        <DropdownMenuLabel className="text-xs text-muted-foreground">
                          {label}
                        </DropdownMenuLabel>
                        {visibleModels.map((m) => {
                          const key = `${g.flavor}/${m}`
                          return (
                            <DropdownMenuRadioItem key={key} value={key}>
                              <span className="truncate">{m}</span>
                            </DropdownMenuRadioItem>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                  {modelFilterValue && !anyModelRowVisible && (
                    allowCustom ? (
                      // Escape hatch for ids the lists don't carry (local
                      // servers, brand-new models): select exactly what was
                      // typed. Scoped pickers attach it to their provider;
                      // un-scoped ones split "provider/model" on the first
                      // slash, else pair the text with the default provider.
                      <DropdownMenuItem
                        onSelect={() => onChange(parseCustomModel(modelFilter.trim(), providerFilter, defaultModel))}
                      >
                        <span className="truncate">Use &quot;{modelFilter.trim()}&quot;</span>
                      </DropdownMenuItem>
                    ) : (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">No models match</div>
                    )
                  )}
                </DropdownMenuRadioGroup>
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
