import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { HarnessSettings } from '@x/shared/src/code-mode'
import { HarnessControls } from './harness-controls'
vi.mock('./code/code-agent-options', () => ({
  fetchCodeAgentOptions: async () => ({ models: [{ value: 'model-a', label: 'Model A' }], efforts: [{ value: 'high', label: 'High' }] }),
  withDefault: (options: unknown[]) => [{ value: 'default', label: 'Default' }, ...options],
}))
vi.mock('./code/code-agent-status', () => ({ AGENT_LABEL: { claude: 'Claude Code', codex: 'Codex' }, fetchCodeAgentsStatus: async () => null, isAgentReady: () => true }))
beforeEach(() => vi.stubGlobal('PointerEvent', MouseEvent))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('chooses model, effort and approvals, resets engine-specific choices on agent switch, and clears approvals', async () => {
  const changed = vi.fn()
  function Host() {
    const [value, setValue] = useState<HarnessSettings>({ enabled: true, agent: 'claude' })
    return <HarnessControls value={value} onChange={(next) => { setValue(next); changed(next) }} />
  }
  render(<Host />)
  const select = async (name: string) => {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Harness agent settings' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitemradio', { name }))
  }
  await select('Model A')
  await select('High')
  await select('Auto-approve reads')
  expect(changed).toHaveBeenLastCalledWith({ enabled: true, agent: 'claude', model: 'model-a', effort: 'high', policy: 'auto-approve-reads' })
  await select('Codex')
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ enabled: true, agent: 'codex', model: undefined, effort: undefined, policy: 'auto-approve-reads' }))
  await select('Use default')
  expect(changed.mock.lastCall?.[0].policy).toBeUndefined()
})
