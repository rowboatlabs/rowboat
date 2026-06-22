import type { CodingAgent } from '@x/shared/src/code-mode.js'
import type { CodeAgentModelOptions, CodeAgentOption } from '@x/shared/src/code-sessions.js'

// Model + effort choices for a coding agent, discovered live from the engine
// (the same list `/model` shows) via the main process, which caches per agent.
// We memoize the in-flight/resolved promise per agent here too so reopening the
// picker doesn't re-hit IPC. A failed lookup resolves to empty lists so the UI
// just falls back to the engine default.
const EMPTY: CodeAgentModelOptions = { models: [], efforts: [] }
const cache = new Map<CodingAgent, Promise<CodeAgentModelOptions>>()

export function fetchCodeAgentOptions(agent: CodingAgent): Promise<CodeAgentModelOptions> {
  let pending = cache.get(agent)
  if (!pending) {
    pending = window.ipc.invoke('codeMode:listModelOptions', { agent }).catch(() => EMPTY)
    cache.set(agent, pending)
  }
  return pending
}

// Always offer a Default fallback even before options load (or if discovery fails).
export function withDefault(options: CodeAgentOption[]): CodeAgentOption[] {
  return options.some((o) => o.value === 'default') ? options : [{ value: 'default', label: 'Default' }, ...options]
}

export function optionLabel(options: CodeAgentOption[], value: string | undefined): string {
  return options.find((o) => o.value === (value ?? 'default'))?.label ?? value ?? 'Default'
}
