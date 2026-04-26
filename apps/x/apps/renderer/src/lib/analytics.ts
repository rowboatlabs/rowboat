// Analytics disabled — all functions are no-ops

export function chatSessionCreated(_runId: string) {}
export function chatMessageSent(_props: { voiceInput?: boolean; voiceOutput?: string; searchEnabled?: boolean }) {}
export function oauthConnected(_provider: string) {}
export function oauthDisconnected(_provider: string) {}
export function voiceInputStarted() {}
export function searchExecuted(_types: string[]) {}
export function noteExported(_format: string) {}
