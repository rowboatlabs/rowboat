import { describe, expect, it } from 'vitest'
import { isAgentReady, type CodeAgentsStatus } from './code-agent-status'

// Readiness is strategy-aware: managed agents need installed + signed in, while
// external agents (OpenCode) gate on detection alone. This asymmetry is the
// whole point of the change and was previously untested.
describe('isAgentReady', () => {
  it('treats a detected external agent as ready even without a sign-in signal', () => {
    const status = {
      claude: { installed: false, signedIn: false },
      codex: { installed: false, signedIn: false },
      opencode: { installed: true, signedIn: false },
    } as CodeAgentsStatus
    expect(isAgentReady(status, 'opencode')).toBe(true)
  })

  it('requires managed agents to be installed and signed in', () => {
    const status = {
      claude: { installed: true, signedIn: false },
      codex: { installed: true, signedIn: true },
      opencode: { installed: false, signedIn: false },
    } as CodeAgentsStatus
    expect(isAgentReady(status, 'claude')).toBe(false)
    expect(isAgentReady(status, 'codex')).toBe(true)
  })

  it('is false for a missing status or missing agent entry', () => {
    expect(isAgentReady(null, 'opencode')).toBe(false)
    expect(isAgentReady(undefined, 'claude')).toBe(false)
  })
})
