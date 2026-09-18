import type { CodingAgent } from '@x/shared/src/code-mode.js'
import { AGENT_CATALOG } from '@x/shared/src/agent-catalog.js'

export type CodeAgentStatus = { installed: boolean; signedIn: boolean; version?: string }
export type CodeAgentsStatus = Record<CodingAgent, CodeAgentStatus>

export const AGENT_LABEL: Record<CodingAgent, string> = {
  opencode: AGENT_CATALOG.opencode.label,
  cursor: AGENT_CATALOG.cursor.label,
  hermes: AGENT_CATALOG.hermes.label,
}

// Which coding agents are detected on PATH. The probe touches the shell, so it's
// cached briefly: the Code view warms it on mount and a quick-create reuses the
// answer instead of paying for it on the click.
const TTL_MS = 60_000
let cached: { at: number; value: Promise<CodeAgentsStatus> } | null = null

export function fetchCodeAgentsStatus(opts?: { fresh?: boolean }): Promise<CodeAgentsStatus> {
  const now = Date.now()
  if (!opts?.fresh && cached && now - cached.at < TTL_MS) return cached.value
  const value = window.ipc.invoke('codeMode:checkAgentStatus', null).then((s) => {
    const out = {} as CodeAgentsStatus
    for (const agent of Object.keys(AGENT_CATALOG) as CodingAgent[]) {
      out[agent] = {
        installed: s[agent]?.installed ?? false,
        signedIn: s[agent]?.signedIn ?? false,
        version: s[agent]?.version,
      }
    }
    return out
  })
  cached = { at: now, value }
  value.catch(() => { if (cached?.value === value) cached = null })
  return value
}

// All agents are externally installed: readiness is detection alone. Kept as a
// helper so callers do not hand-roll the predicate and drift.
export function isAgentReady(status: CodeAgentsStatus | null | undefined, agent: CodingAgent): boolean {
  return Boolean(status?.[agent]?.installed)
}