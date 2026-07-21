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
import { useProviderModels } from '@/hooks/use-provider-models'

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

// Phase 1 of the model-selection consolidation: this is the chat composer's
// picker extracted verbatim (full catalog grouped by provider, live groups,
// search filter, reasoning effort). Later phases add the other selection
// modes on top of the same controlled value/onChange contract — a use-case
// default with a "Rowboat default" sentinel, "(global default)" inheritance
// for per-task overrides, and caller-supplied restricted lists — as new
// optional props, not new components.
export interface ModelSelectorProps {
  /** Current selection; null follows the app default. */
  value: ModelRef | null
  onChange: (value: ModelRef) => void
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

export function ModelSelector({
  value,
  onChange,
  lockedModel = null,
  effort = '',
  onEffortChange,
}: ModelSelectorProps) {
  const { groups, reasoningByKey, defaultModel } = useModels()

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
  // pin the default themselves, so a flavor match is enough there.
  const standaloneDefault = useMemo<ModelRef | null>(() => {
    if (!defaultModel) return null
    const covered = groups.some((g) =>
      g.flavor === defaultModel.provider &&
      (g.kind === 'live' || g.models.includes(defaultModel.model)))
    return covered ? null : defaultModel
  }, [groups, defaultModel])

  const standaloneVisible = standaloneDefault !== null &&
    (!modelFilterValue || standaloneDefault.model.toLowerCase().includes(modelFilterValue))
  // Nothing matches anywhere → "No models match". Live groups that haven't
  // reported yet (first render after opening) count as having rows so the
  // empty row never flashes.
  const anyModelRowVisible = standaloneVisible || groups.some((g) =>
    g.kind === 'catalog'
      ? g.models.some((m) => m.toLowerCase().includes(modelFilterValue))
      : liveGroupHasRows[g.flavor] !== false)

  const handleModelChange = useCallback((key: string) => {
    if (lockedModel) return
    const slash = key.indexOf('/')
    if (slash <= 0 || slash === key.length - 1) return
    onChange({ provider: key.slice(0, slash), model: key.slice(slash + 1) })
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
            <button
              type="button"
              className="flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <span className="min-w-0 truncate">
                {getModelDisplayName(value?.model || defaultModel?.model || 'Model')}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="p-0 overflow-hidden">
            {groups.length === 0 && !standaloneDefault ? (
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
                  value={value ? `${value.provider}/${value.model}` : (defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : '')}
                  onValueChange={handleModelChange}
                >
                  {standaloneDefault && standaloneVisible && (
                    <DropdownMenuRadioItem value={`${standaloneDefault.provider}/${standaloneDefault.model}`}>
                      <span className="truncate">{standaloneDefault.model}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {providerDisplayNames[standaloneDefault.provider] || standaloneDefault.provider}
                      </span>
                    </DropdownMenuRadioItem>
                  )}
                  {groups.map((g) => {
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
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No models match</div>
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
