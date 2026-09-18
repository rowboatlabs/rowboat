import type { CodingAgent } from '@x/shared/src/code-mode.js'

// Status types shared by the Settings and onboarding surfaces. Every coding
// agent is externally installed and detected on PATH, so there is no engine
// provisioning state to track here anymore.
export type AgentAccount = { email?: string; plan?: string }
export type AgentStatus = { installed: boolean; signedIn: boolean; account?: AgentAccount; version?: string }
export type CodeModeAgentStatus = Record<CodingAgent, AgentStatus>