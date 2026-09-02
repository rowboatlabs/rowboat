import type { CodingAgent } from '@x/shared/src/code-mode.js'

export type CodeAgentStatus = { installed: boolean; signedIn: boolean }
export type CodeAgentsStatus = Record<CodingAgent, CodeAgentStatus>

export const AGENT_LABEL: Record<CodingAgent, string> = { claude: 'Claude Code', codex: 'Codex' }

// Which coding agents are installed and signed in. The probe touches the
// shell and keychain, so it's cached briefly: the Code view warms it on
// mount and a quick-create reuses the answer instead of paying for it on
// the click.
const TTL_MS = 60_000
let cached: { at: number; value: Promise<CodeAgentsStatus> } | null = null

export function fetchCodeAgentsStatus(opts?: { fresh?: boolean }): Promise<CodeAgentsStatus> {
  const now = Date.now()
  if (!opts?.fresh && cached && now - cached.at < TTL_MS) return cached.value
  const value = window.ipc.invoke('codeMode:checkAgentStatus', null).then((s) => ({
    claude: { installed: s.claude.installed, signedIn: s.claude.signedIn },
    codex: { installed: s.codex.installed, signedIn: s.codex.signedIn },
  }))
  cached = { at: now, value }
  value.catch(() => { if (cached?.value === value) cached = null })
  return value
}

export function isAgentReady(status: CodeAgentsStatus | null | undefined, agent: CodingAgent): boolean {
  const s = status?.[agent]
  return Boolean(s && s.installed && s.signedIn)
}
