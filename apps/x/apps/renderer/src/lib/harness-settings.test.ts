import { beforeEach, expect, it } from 'vitest'
import { readHarnessSettings, saveHarnessSettings, harnessComposition } from './harness-settings'
beforeEach(() => localStorage.clear())
it('restores each conversation independently and serializes choices for a turn', () => {
  const value = { enabled: true, agent: 'codex' as const, model: 'model-a', effort: 'high', policy: 'ask' as const }
  saveHarnessSettings('chat-a', value)
  expect(readHarnessSettings('chat-a')).toEqual(value)
  expect(readHarnessSettings('chat-b')).toEqual({ enabled: false, agent: 'claude' })
  expect(harnessComposition(value)).toEqual({ harness: value })
  expect(harnessComposition()).toEqual({})
})
