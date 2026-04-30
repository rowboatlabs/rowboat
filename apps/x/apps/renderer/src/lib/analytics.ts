import posthog from 'posthog-js'

export function chatSessionCreated(runId: string) {
  posthog.capture('chat_session_created', { run_id: runId })
}

export function chatMessageSent(props: {
  voiceInput?: boolean
  voiceOutput?: string
  searchEnabled?: boolean
}) {
  posthog.capture('chat_message_sent', {
    voice_input: props.voiceInput ?? false,
    voice_output: props.voiceOutput ?? false,
    search_enabled: props.searchEnabled ?? false,
  })
}

export function oauthConnected(provider: string) {
  posthog.capture('oauth_connected', { provider })
}

export function oauthDisconnected(provider: string) {
  posthog.capture('oauth_disconnected', { provider })
}

export function voiceInputStarted() {
  posthog.capture('voice_input_started')
}

export function searchExecuted(types: string[]) {
  posthog.capture('search_executed', { types })
}

export function noteExported(format: string) {
  posthog.capture('note_exported', { format })
}
