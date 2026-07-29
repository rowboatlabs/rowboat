import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Check, ChevronDown } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useModels, type ModelPickerGroup, type ModelRef } from '@/hooks/use-models'
import { cn } from '@/lib/utils'

export type { ModelRef } from '@/hooks/use-models'

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
const REASONING_EFFORT_OPTIONS: Array<{ value: '' | ReasoningEffortLevel; label: string; hint: string }> = [
  { value: '', label: 'Auto', hint: 'Provider default' },
  { value: 'low', label: 'Fast', hint: 'Minimal thinking' },
  { value: 'medium', label: 'Balanced', hint: 'Moderate thinking' },
  { value: 'high', label: 'Thorough', hint: 'Deep thinking, costs more' },
]

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
  /** Current selection; null follows the app default / the sentinel. */
  value: ModelRef | null
  /** null only ever fires when defaultOption is set (sentinel picked). */
  onChange: (value: ModelRef | null) => void
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
   * Reasoning effort ('' = auto). The control renders only for models the
   * catalog flags as reasoning-capable. When the effective model loses
   * reasoning support, '' is reported up so a stale effort never outlives
   * its model. Omit onEffortChange to hide the effort control entirely.
   */
  effort?: '' | ReasoningEffortLevel
  onEffortChange?: (effort: '' | ReasoningEffortLevel) => void
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
  allowCustom = false,
  staticOptions,
  triggerTitle,
  lockedModel = null,
  effort = '',
  onEffortChange,
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

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
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

  const select = useCallback((ref: ModelRef | null) => {
    if (lockedModel) return
    setOpen(false)
    onChange(ref)
  }, [lockedModel, onChange])

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

  const renderModelItem = (providerId: string, model: string, secondary?: string) => {
    const key = `${providerId}/${model}`
    return (
      <CommandItem
        key={key}
        value={key}
        onSelect={() => select({ provider: providerId, model })}
      >
        <Check className={cn('size-3.5 shrink-0', selectedKey === key ? 'opacity-100' : 'opacity-0')} />
        <span className="truncate">{model}</span>
        {secondary && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{secondary}</span>}
      </CommandItem>
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
        // modal: the settings Dialog's scroll-lock cancels wheel events over
        // content portalled outside its subtree — a modal popover brings its
        // own lock layer that permits scrolling within (Radix's supported
        // fix for popover-inside-dialog; matches the old DropdownMenu's
        // modality). Keyboard scrolling was never affected (cmdk uses
        // programmatic scrollIntoView).
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
          </PopoverTrigger>
          <PopoverContent
            align={variant === 'field' ? 'start' : 'end'}
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
                  onValueChange={setQuery}
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
                    <CommandList className="max-h-80 flex-1">
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
                  <CommandList className="max-h-80">
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
        </Popover>
      )}
    </>
  )
}
