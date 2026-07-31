import { useSyncExternalStore } from 'react'

// Which chat currently owns the microphone.
//
// The mic is one physical resource: useVoiceMode (PTT/STT) and the call
// engine are instantiated once at App level. Historically "only one chat
// records at a time" was enforced implicitly — recording props were wired
// only to the ACTIVE tab's composer — which breaks down the moment chat
// sessions are self-sufficient components that can each try to start
// voice. This store makes ownership an explicit token:
//
// - `acquireVoice(holderId, onStolen)` — take the mic. If another holder
//   owns it, its `onStolen` runs first (cancel recording, tear down UI),
//   so acquisition is always a clean hand-off, never a shared mic.
// - `releaseVoice(holderId)` — free it; ignored unless you are the owner,
//   so a stale release can never revoke a newer holder.
// - `useVoiceOwner()` — reactive owner id for render gating
//   (`owner === myChatId`), via useSyncExternalStore.
//
// Holder ids are chat ids for composer push-to-talk; calls use the
// reserved CALL_VOICE_HOLDER (a call owns the mic for its whole duration
// and outranks PTT — see the acquire call sites in App).

export const CALL_VOICE_HOLDER = '__call__'

interface VoiceOwner {
  holderId: string
  onStolen: () => void
}

let owner: VoiceOwner | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function acquireVoice(holderId: string, onStolen: () => void): void {
  if (owner && owner.holderId !== holderId) {
    // Hand-off: the previous holder cleans up before ownership moves.
    owner.onStolen()
  }
  owner = { holderId, onStolen }
  emit()
}

export function releaseVoice(holderId: string): void {
  if (owner?.holderId !== holderId) return
  owner = null
  emit()
}

export function voiceOwnerId(): string | null {
  return owner?.holderId ?? null
}

export function subscribeVoiceOwner(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVoiceOwner(): string | null {
  return useSyncExternalStore(subscribeVoiceOwner, voiceOwnerId)
}

// Test-only.
export function __resetVoiceOwnershipForTests(): void {
  owner = null
  listeners.clear()
}
