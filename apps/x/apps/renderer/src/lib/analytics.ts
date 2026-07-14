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

export function appOpened(folder: string) {
  posthog.capture('app_opened', { folder })
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

export function callStarted(preset: 'voice' | 'video' | 'share' | 'practice') {
  posthog.capture('call_started', { preset })
}

// Voice-to-voice latency breakdown for one call turn (all milliseconds):
// utterance accepted → message submitted → first TTS speak() → audio playing.
export function callTurnLatency(props: {
  endpointToSubmitMs: number
  submitToSpeakMs: number
  speakToAudioMs: number
  totalMs: number
}) {
  posthog.capture('call_turn_latency', {
    endpoint_to_submit_ms: Math.round(props.endpointToSubmitMs),
    submit_to_speak_ms: Math.round(props.submitToSpeakMs),
    speak_to_audio_ms: Math.round(props.speakToAudioMs),
    total_ms: Math.round(props.totalMs),
  })
}

export function searchExecuted(types: string[]) {
  posthog.capture('search_executed', { types })
}

export function noteExported(format: string) {
  posthog.capture('note_exported', { format })
}

// ---------------------------------------------------------------------------
// Feature usage instrumentation. One `view_opened` per navigation (the
// feature-importance funnel), plus per-feature action events. Everything below
// answers "how many people use X and what do they do inside it".
// ---------------------------------------------------------------------------

export type AppView =
  | 'chat'
  | 'file'
  | 'graph'
  | 'task'
  | 'suggested-topics'
  | 'meetings'
  | 'live-notes'
  | 'email'
  | 'workspace'
  | 'knowledge-view'
  | 'chat-history'
  | 'home'
  | 'code'
  | 'bg-tasks'
  | 'apps'

// Views that count as "using a feature" — first visit sets a person property
// so PostHog cohorts can answer "how many people have ever used meetings".
const FIRST_USE_VIEWS: Partial<Record<AppView, string>> = {
  email: 'has_used_email',
  meetings: 'has_used_meetings',
  'live-notes': 'has_used_live_notes',
  'bg-tasks': 'has_used_bg_agents',
  apps: 'has_used_apps',
  code: 'has_used_code',
}

export function viewOpened(view: AppView) {
  posthog.capture('view_opened', { view })
  const flag = FIRST_USE_VIEWS[view]
  if (flag) posthog.people.set_once({ [flag]: true })
}

// --- Email ---

export function emailThreadOpened() {
  posthog.capture('email_thread_opened')
}

export function emailComposeOpened(mode: string) {
  posthog.capture('email_compose_opened', { mode })
}

export function emailSent(props: { mode: string; hasAttachments: boolean; aiAssisted: boolean }) {
  posthog.capture('email_sent', {
    mode: props.mode,
    has_attachments: props.hasAttachments,
    ai_assisted: props.aiAssisted,
  })
}

export function emailAiDraftGenerated(mode: 'generate' | 'rewrite') {
  posthog.capture('email_ai_draft_generated', { mode })
}

export function emailArchived() {
  posthog.capture('email_archived')
}

export function emailTrashed() {
  posthog.capture('email_trashed')
}

export function emailMarkedUnread() {
  posthog.capture('email_marked_unread')
}

export function emailImportanceChanged(importance: string) {
  posthog.capture('email_importance_changed', { importance })
}

export function emailCategoryChanged(category: string) {
  posthog.capture('email_category_changed', { category })
}

export function emailCategoryArchived(category: string) {
  posthog.capture('email_category_archived', { category })
}

export function emailSearched() {
  posthog.capture('email_searched')
}

export function emailInstructionsSaved() {
  posthog.capture('email_instructions_saved')
}

export function emailSyncTriggered() {
  posthog.capture('email_sync_triggered')
}

// --- Meetings ---

export function meetingRecordingStarted(hasCalendarEvent: boolean) {
  posthog.capture('meeting_recording_started', { has_calendar_event: hasCalendarEvent })
  posthog.people.set_once({ has_used_meetings: true })
}

export function meetingRecordingStopped(durationSeconds: number) {
  posthog.capture('meeting_recording_stopped', { duration_seconds: Math.round(durationSeconds) })
}

// meeting_popup_action is captured in the main process (the popup window runs
// without PostHog) — see apps/main/src/ipc.ts 'meetingDetect:action'.

export function meetingNoteOpened() {
  posthog.capture('meeting_note_opened')
}

// --- Calls ---

export function callEnded(durationSeconds: number) {
  posthog.capture('call_ended', { duration_seconds: Math.round(durationSeconds) })
}

// --- Background agents ---

export function bgAgentCreated(props: { method: 'manual' | 'coding' | 'copilot'; hasTriggers: boolean }) {
  posthog.capture('bg_agent_created', { method: props.method, has_triggers: props.hasTriggers })
  posthog.people.set_once({ has_created_bg_agent: true })
}

export function bgAgentUpdated() {
  posthog.capture('bg_agent_updated')
}

export function bgAgentToggled(active: boolean) {
  posthog.capture('bg_agent_toggled', { active })
}

export function bgAgentRunClicked() {
  posthog.capture('bg_agent_run_clicked')
}

export function bgAgentStopped() {
  posthog.capture('bg_agent_stopped')
}

export function bgAgentDeleted() {
  posthog.capture('bg_agent_deleted')
}

// --- Live notes ---

export function liveNoteSaved() {
  posthog.capture('live_note_saved')
}

export function liveNoteToggled(active: boolean) {
  posthog.capture('live_note_toggled', { active })
}

export function liveNoteRunClicked() {
  posthog.capture('live_note_run_clicked')
}

export function liveNoteStopped() {
  posthog.capture('live_note_stopped')
}

export function liveNoteDeleted() {
  posthog.capture('live_note_deleted')
}

export function liveNoteEditWithCopilotClicked() {
  posthog.capture('live_note_edit_with_copilot_clicked')
}

// --- Search ---

export function searchOpened() {
  posthog.capture('search_opened')
}

export function searchResultSelected(type: string) {
  posthog.capture('search_result_selected', { type })
}

// Apps install/update/publish/star/delete events are captured in the main
// process (apps/main/src/ipc.ts) where the operations actually run.

// --- Billing ---

export function billingErrorShown(kind: string) {
  posthog.capture('billing_error_shown', { kind })
}

export function billingUpgradeClicked(kind: string) {
  posthog.capture('billing_upgrade_clicked', { kind })
}

// --- Failures ---

export function emailSendFailed() {
  posthog.capture('email_send_failed')
}

export function meetingSummarizeFailed() {
  posthog.capture('meeting_summarize_failed')
}

// --- Notes / settings / onboarding ---

export function noteCreated() {
  posthog.capture('note_created')
}

// The autosave loop fires on every debounced keystroke burst, so dedupe to one
// event per note per app session — "was this note edited", not "how many saves".
const editedNotePaths = new Set<string>()
export function noteEdited(path: string) {
  if (editedNotePaths.has(path)) return
  editedNotePaths.add(path)
  posthog.capture('note_edited')
}

export function settingsOpened(tab: string) {
  posthog.capture('settings_opened', { tab })
}

export function settingsTabChanged(tab: string) {
  posthog.capture('settings_tab_changed', { tab })
}

export function onboardingCompleted() {
  posthog.capture('onboarding_completed')
}
