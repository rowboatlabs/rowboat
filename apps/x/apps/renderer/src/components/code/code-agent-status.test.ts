import { describe, expect, it } from 'vitest'
import { isAgentReady, type CodeAgentsStatus } from './code-agent-status'

// All agents are externally installed: readiness is detection alone.
describe('isAgentReady', () => {
  it('is ready when the agent is detected on PATH', () => {
    const status = {
      opencode: { installed: true, signedIn: false },
      cursor: { installed: false, signedIn: false },
      hermes: { installed: false, signedIn: false },
    } as CodeAgentsStatus
    expect(isAgentReady(status, 'opencode')).toBe(true)
  })

  it('is not ready when the agent is not detected', () => {
    const status = {
      opencode: { installed: false, signedIn: true },
      cursor: { installed: true, signedIn: true },
      hermes: { installed: true, signedIn: true },
    } as CodeAgentsStatus
    expect(isAgentReady(status, 'opencode')).toBe(false)
    expect(isAgentReady(status, 'cursor')).toBe(true)
  })

  it('is false for a missing status or missing agent entry', () => {
    expect(isAgentReady(null, 'hermes')).toBe(false)
    expect(isAgentReady(undefined, 'cursor')).toBe(false)
  })
})