import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetVoiceOwnershipForTests,
  acquireVoice,
  releaseVoice,
  subscribeVoiceOwner,
  voiceOwnerId,
} from './voice-ownership'

beforeEach(__resetVoiceOwnershipForTests)

describe('voice ownership', () => {
  it('acquire takes the mic and release frees it', () => {
    acquireVoice('chat-a', () => {})
    expect(voiceOwnerId()).toBe('chat-a')
    releaseVoice('chat-a')
    expect(voiceOwnerId()).toBeNull()
  })

  it('acquiring over another holder runs its onStolen before ownership moves', () => {
    const stolen = vi.fn(() => {
      // The previous holder still observes itself as owner while cleaning up.
      expect(voiceOwnerId()).toBe('chat-a')
    })
    acquireVoice('chat-a', stolen)
    acquireVoice('chat-b', () => {})
    expect(stolen).toHaveBeenCalledOnce()
    expect(voiceOwnerId()).toBe('chat-b')
  })

  it('re-acquiring as the current owner does not self-steal', () => {
    const stolen = vi.fn()
    acquireVoice('chat-a', stolen)
    acquireVoice('chat-a', stolen)
    expect(stolen).not.toHaveBeenCalled()
    expect(voiceOwnerId()).toBe('chat-a')
  })

  it('a stale release cannot revoke a newer holder', () => {
    acquireVoice('chat-a', () => {})
    acquireVoice('chat-b', () => {})
    releaseVoice('chat-a')
    expect(voiceOwnerId()).toBe('chat-b')
  })

  it('notifies subscribers on every ownership change', () => {
    const seen: Array<string | null> = []
    const unsubscribe = subscribeVoiceOwner(() => seen.push(voiceOwnerId()))
    acquireVoice('chat-a', () => {})
    acquireVoice('chat-b', () => {})
    releaseVoice('chat-b')
    unsubscribe()
    acquireVoice('chat-c', () => {})
    expect(seen).toEqual(['chat-a', 'chat-b', null])
  })
})
