import posthog from 'posthog-js'

let appVersion: string | undefined
let apiUrl: string | undefined

function appVersionProperties(): Record<string, string> {
  return appVersion ? { app_version: appVersion } : {}
}

export function configureAnalyticsContext(props: { appVersion?: string; apiUrl?: string }) {
  appVersion = props.appVersion?.trim() || undefined
  apiUrl = props.apiUrl?.trim() || undefined

  const eventProperties = appVersionProperties()
  if (Object.keys(eventProperties).length > 0) {
    posthog.register(eventProperties)
  }

  const personProperties = {
    ...(apiUrl ? { api_url: apiUrl } : {}),
    ...eventProperties,
  }
  if (Object.keys(personProperties).length > 0) {
    posthog.people.set(personProperties)
  }
}

export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  posthog.identify(userId, {
    ...properties,
    ...appVersionProperties(),
  })
}

export function resetAnalyticsIdentity() {
  posthog.reset()
  configureAnalyticsContext({ appVersion, apiUrl })
}

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
