import { useState, useEffect, useCallback } from "react"
import { setGoogleCredentials, clearGoogleCredentials } from "@/lib/google-credentials-store"
import { toast } from "sonner"

export interface ProviderState {
  isConnected: boolean
  isLoading: boolean
  isConnecting: boolean
}

export interface ProviderStatus {
  error?: string
}

type KnowledgeSourceConfig = {
  id: string
  provider: 'gmail' | 'meeting' | 'voice_memo' | 'slack' | 'github' | 'linear'
  enabled: boolean
  artifactDir: string
  syncMode: 'file' | 'poll' | 'event' | 'manual'
  intervalMs?: number
  scopes: Array<{ type: string; id: string; name?: string; workspaceUrl?: string }>
  instructions?: string
  filters?: Record<string, unknown>
}

export type SlackSyncStatus = {
  id: string
  enabled: boolean
  lastSyncAt?: string
  lastStatus?: 'ok' | 'error'
  lastError?: { kind: string; message: string }
  nextDueAt?: string
}

/**
 * Map a structured agent-slack failure to actionable user copy. The key
 * distinction (raised by real usage): a missing Slack desktop app needs a
 * different instruction than a signed-out one.
 */
export function actionableSlackError(kind?: string, message?: string): string {
  // Windows locks Slack's Cookies/LevelDB files while it's running, so the
  // desktop import copy fails with EBUSY. This can surface under any kind, so
  // check the message first.
  if (message && /EBUSY|resource busy|locked|copyfile/i.test(message)) {
    return 'Slack is open and locking its data. Click "Quit Slack & connect" to close it automatically, or use "Paste from browser instead".'
  }
  switch (kind) {
    case 'not_installed':
      return 'The Slack helper is unavailable in this build. Please update or reinstall Rowboat.'
    case 'network':
      return "Couldn't reach Slack. Check your internet connection and try again."
    case 'rate_limited':
      return 'Slack is rate-limiting requests right now. Wait a minute and try again.'
    case 'bad_channel':
      return message || "A configured channel couldn't be found. Check the channel names in Settings."
    case 'not_authed':
      if (message && /Desktop data not found|not supported/i.test(message)) {
        return 'No Slack desktop app was found. Install Slack, sign in to your workspace, then click Connect.'
      }
      return 'No signed-in Slack account found. Open the Slack desktop app, sign in, then click Connect.'
    default:
      return message || "Couldn't connect to Slack. Please try again."
  }
}

export function useConnectors(active: boolean) {
  const [providers, setProviders] = useState<string[]>([])
  const [providersLoading, setProvidersLoading] = useState(true)
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({})
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({})
  const [googleClientIdOpen, setGoogleClientIdOpen] = useState(false)
  const [googleClientIdDescription, setGoogleClientIdDescription] = useState<string | undefined>(undefined)

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false)
  const [granolaLoading, setGranolaLoading] = useState(true)

  // Composio API key state
  const [composioApiKeyOpen, setComposioApiKeyOpen] = useState(false)
  const [composioApiKeyTarget, setComposioApiKeyTarget] = useState<'slack' | 'gmail'>('gmail')

  // Slack state
  const [slackEnabled, setSlackEnabled] = useState(false)
  const [slackLoading, setSlackLoading] = useState(true)
  const [slackWorkspaces, setSlackWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackAvailableWorkspaces, setSlackAvailableWorkspaces] = useState<Array<{ url: string; name: string }>>([])
  const [slackSelectedUrls, setSlackSelectedUrls] = useState<Set<string>>(new Set())
  const [slackPickerOpen, setSlackPickerOpen] = useState(false)
  const [slackDiscovering, setSlackDiscovering] = useState(false)
  const [slackDiscoverError, setSlackDiscoverError] = useState<string | null>(null)
  // True when discovery succeeded but no workspaces are connected yet, so the
  // user needs to import auth from the Slack desktop app (fixes the silent
  // "Enable" bounce-back where the button never progressed).
  const [slackNeedsAuth, setSlackNeedsAuth] = useState(false)
  const [slackAuthImporting, setSlackAuthImporting] = useState(false)
  // Cross-OS "paste cURL from a browser tab" fallback when desktop import fails.
  const [slackCurlOpen, setSlackCurlOpen] = useState(false)
  const [slackCurlValue, setSlackCurlValue] = useState("")
  const [slackCurlSubmitting, setSlackCurlSubmitting] = useState(false)
  const [slackKnowledgeEnabled, setSlackKnowledgeEnabled] = useState(false)
  const [slackKnowledgeChannels, setSlackKnowledgeChannels] = useState("")
  const [slackKnowledgeSaving, setSlackKnowledgeSaving] = useState(false)
  const [slackSyncStatuses, setSlackSyncStatuses] = useState<SlackSyncStatus[]>([])

  // Composio Gmail/Calendar sync was removed. These flags are seeded false
  // and never flipped — the IPC that used to set them is gone. The setters
  // remain so the legacy Composio-Gmail handlers below still type-check,
  // but those handlers are no longer reachable in the UI (the gating
  // condition `useComposioForGoogle` stays false).
  // TODO follow-up: drop these flags entirely and prune the dead UI branches
  // in connectors-popover, connected-accounts-settings, and onboarding-modal.
  const [useComposioForGoogle] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailLoading, setGmailLoading] = useState(false)
  const [gmailConnecting, setGmailConnecting] = useState(false)

  const [useComposioForGoogleCalendar] = useState(false)
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false)
  const [googleCalendarLoading, setGoogleCalendarLoading] = useState(false)
  const [googleCalendarConnecting, setGoogleCalendarConnecting] = useState(false)

  // Load available providers on mount
  useEffect(() => {
    async function loadProviders() {
      try {
        setProvidersLoading(true)
        const result = await window.ipc.invoke('oauth:list-providers', null)
        setProviders(result.providers || [])
      } catch (error) {
        console.error('Failed to get available providers:', error)
        setProviders([])
      } finally {
        setProvidersLoading(false)
      }
    }
    loadProviders()
  }, [])

  // (Composio Gmail/Calendar flag-check effect removed — flags are constant false now.)

  // Load Granola config
  const refreshGranolaConfig = useCallback(async () => {
    try {
      setGranolaLoading(true)
      const result = await window.ipc.invoke('granola:getConfig', null)
      setGranolaEnabled(result.enabled)
    } catch (error) {
      console.error('Failed to load Granola config:', error)
      setGranolaEnabled(false)
    } finally {
      setGranolaLoading(false)
    }
  }, [])

  const handleGranolaToggle = useCallback(async (enabled: boolean) => {
    try {
      setGranolaLoading(true)
      await window.ipc.invoke('granola:setConfig', { enabled })
      setGranolaEnabled(enabled)
      toast.success(enabled ? 'Granola sync enabled' : 'Granola sync disabled')
    } catch (error) {
      console.error('Failed to update Granola config:', error)
      toast.error('Failed to update Granola sync settings')
    } finally {
      setGranolaLoading(false)
    }
  }, [])

  // Slack
  const refreshSlackConfig = useCallback(async () => {
    try {
      setSlackLoading(true)
      const result = await window.ipc.invoke('slack:getConfig', null)
      setSlackEnabled(result.enabled)
      setSlackWorkspaces(result.workspaces || [])
    } catch (error) {
      console.error('Failed to load Slack config:', error)
      setSlackEnabled(false)
      setSlackWorkspaces([])
    } finally {
      setSlackLoading(false)
    }
  }, [])

  const handleSlackEnable = useCallback(async () => {
    setSlackDiscovering(true)
    setSlackDiscoverError(null)
    setSlackNeedsAuth(false)
    setSlackCurlOpen(false)
    setSlackCurlValue("")
    setSlackPickerOpen(true)
    try {
      const result = await window.ipc.invoke('slack:listWorkspaces', null)
      if (result.workspaces.length > 0) {
        // Already-connected workspaces → straight to the picker.
        setSlackAvailableWorkspaces(result.workspaces)
        setSlackSelectedUrls(new Set(result.workspaces.map((w: { url: string }) => w.url)))
      } else {
        // CLI ran but nothing is connected yet (or it errored): offer a
        // concrete next step instead of a dead-end message.
        setSlackAvailableWorkspaces([])
        setSlackNeedsAuth(true)
        setSlackDiscoverError(result.error ? actionableSlackError(result.errorKind, result.error) : null)
      }
    } catch (error) {
      console.error('Failed to discover Slack workspaces:', error)
      setSlackNeedsAuth(true)
      setSlackDiscoverError("Couldn't start Slack discovery. Please try again.")
    } finally {
      setSlackDiscovering(false)
    }
  }, [])

  // Shared success path for both auth methods: show the discovered workspaces
  // in the picker, preselected. Returns true when workspaces were found.
  const applyDiscoveredWorkspaces = useCallback((result: { ok: boolean; workspaces: Array<{ url: string; name: string }>; error?: string; errorKind?: string }) => {
    if (result.ok && result.workspaces.length > 0) {
      setSlackAvailableWorkspaces(result.workspaces)
      setSlackSelectedUrls(new Set(result.workspaces.map((w) => w.url)))
      setSlackNeedsAuth(false)
      setSlackCurlOpen(false)
      setSlackCurlValue("")
      return true
    }
    setSlackDiscoverError(actionableSlackError(result.errorKind, result.error))
    return false
  }, [])

  // Import xoxc token + cookie from the signed-in Slack desktop app, then show
  // the discovered workspaces in the picker.
  const handleSlackImportDesktop = useCallback(async () => {
    setSlackAuthImporting(true)
    setSlackDiscoverError(null)
    try {
      const result = await window.ipc.invoke('slack:importDesktopAuth', null)
      // Desktop import is best-effort: it fails when Slack is running and locks
      // its Cookies DB (EBUSY on Windows), or on unsupported Slack builds. On
      // any failure, reveal the browser-paste fallback so the user is never
      // stuck — it has no file-lock dependency and works cross-OS.
      if (!applyDiscoveredWorkspaces(result)) {
        setSlackCurlOpen(true)
      }
    } catch (error) {
      console.error('Failed to import Slack desktop auth:', error)
      setSlackDiscoverError("Couldn't import from the Slack desktop app. Please try again, or paste from your browser below.")
      setSlackCurlOpen(true)
    } finally {
      setSlackAuthImporting(false)
    }
  }, [applyDiscoveredWorkspaces])

  // Windows-only: force-quit Slack (releases its Cookies-DB lock) then import.
  // One click instead of the manual taskkill dance.
  const handleSlackQuitAndImport = useCallback(async () => {
    setSlackAuthImporting(true)
    setSlackDiscoverError(null)
    try {
      const result = await window.ipc.invoke('slack:quitAndImportDesktop', null)
      if (!applyDiscoveredWorkspaces(result)) {
        setSlackCurlOpen(true)
      }
    } catch (error) {
      console.error('Failed to quit Slack and import:', error)
      setSlackDiscoverError("Couldn't import after closing Slack. Please try again, or paste from your browser below.")
      setSlackCurlOpen(true)
    } finally {
      setSlackAuthImporting(false)
    }
  }, [applyDiscoveredWorkspaces])

  // Fallback: parse a "Copy as cURL" request pasted from a signed-in Slack web
  // tab. Works on every OS — no desktop app, leveldb, or keychain needed.
  const handleSlackParseCurl = useCallback(async () => {
    setSlackCurlSubmitting(true)
    setSlackDiscoverError(null)
    try {
      const result = await window.ipc.invoke('slack:parseCurlAuth', { curl: slackCurlValue })
      applyDiscoveredWorkspaces(result)
    } catch (error) {
      console.error('Failed to parse Slack cURL:', error)
      setSlackDiscoverError("Couldn't read that cURL command. Please try again.")
    } finally {
      setSlackCurlSubmitting(false)
    }
  }, [applyDiscoveredWorkspaces, slackCurlValue])

  const handleSlackSaveWorkspaces = useCallback(async () => {
    const selected = slackAvailableWorkspaces.filter(w => slackSelectedUrls.has(w.url))
    try {
      setSlackLoading(true)
      await window.ipc.invoke('slack:setConfig', { enabled: true, workspaces: selected })
      setSlackEnabled(true)
      setSlackWorkspaces(selected)
      setSlackPickerOpen(false)
      setSlackNeedsAuth(false)
      toast.success('Slack enabled')
    } catch (error) {
      console.error('Failed to save Slack config:', error)
      toast.error('Failed to save Slack settings')
    } finally {
      setSlackLoading(false)
    }
  }, [slackAvailableWorkspaces, slackSelectedUrls])

  const handleSlackDisable = useCallback(async () => {
    try {
      setSlackLoading(true)
      await window.ipc.invoke('slack:setConfig', { enabled: false, workspaces: [] })
      setSlackEnabled(false)
      setSlackWorkspaces([])
      setSlackPickerOpen(false)
      setSlackNeedsAuth(false)
      setSlackCurlOpen(false)
      setSlackCurlValue("")
      await window.ipc.invoke('knowledgeSources:upsert', {
        id: 'slack',
        provider: 'slack',
        enabled: false,
        artifactDir: 'knowledge_sources/slack',
        syncMode: 'poll',
        intervalMs: 5 * 60 * 1000,
        scopes: [],
      })
      setSlackKnowledgeEnabled(false)
      setSlackKnowledgeChannels("")
      toast.success('Slack disabled')
    } catch (error) {
      console.error('Failed to update Slack config:', error)
      toast.error('Failed to update Slack settings')
    } finally {
      setSlackLoading(false)
    }
  }, [])

  const refreshSlackKnowledgeStatus = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('slack:knowledgeStatus', null)
      setSlackSyncStatuses(result.sources)
    } catch (error) {
      console.error('Failed to load Slack knowledge status:', error)
      setSlackSyncStatuses([])
    }
  }, [])

  const refreshKnowledgeSources = useCallback(async () => {
    try {
      const result = await window.ipc.invoke('knowledgeSources:getConfig', null)
      const slackSource = (result.sources as KnowledgeSourceConfig[]).find(source => source.id === 'slack')
      setSlackKnowledgeEnabled(Boolean(slackSource?.enabled))
      setSlackKnowledgeChannels((slackSource?.scopes ?? [])
        .filter(scope => scope.type === 'channel')
        .map(scope => {
          const channel = scope.name || scope.id
          return scope.workspaceUrl ? `${scope.workspaceUrl} ${channel}` : channel
        })
        .join('\n'))
    } catch (error) {
      console.error('Failed to load knowledge sources:', error)
      setSlackKnowledgeEnabled(false)
      setSlackKnowledgeChannels("")
    }
  }, [])

  const parseSlackKnowledgeScopes = useCallback(() => {
    const defaultWorkspaceUrl = slackWorkspaces.length === 1 ? slackWorkspaces[0]?.url : undefined
    return slackKnowledgeChannels
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split(/\s+/)
        const first = parts[0] ?? ''
        const hasWorkspace = /^https?:\/\//.test(first)
        const workspaceUrl = hasWorkspace ? first : defaultWorkspaceUrl
        const channelRaw = hasWorkspace ? parts.slice(1).join(' ') : line
        const channel = channelRaw.trim()
        return {
          type: 'channel',
          id: channel.replace(/^#/, ''),
          name: channel.startsWith('#') ? channel : `#${channel}`,
          workspaceUrl,
        }
      })
      .filter(scope => scope.id.length > 0)
  }, [slackKnowledgeChannels, slackWorkspaces])

  const handleSlackKnowledgeSave = useCallback(async () => {
    try {
      setSlackKnowledgeSaving(true)
      const scopes = parseSlackKnowledgeScopes()
      await window.ipc.invoke('knowledgeSources:upsert', {
        id: 'slack',
        provider: 'slack',
        enabled: slackKnowledgeEnabled && scopes.length > 0,
        artifactDir: 'knowledge_sources/slack',
        syncMode: 'poll',
        intervalMs: 5 * 60 * 1000,
        scopes,
        instructions: 'Use Slack messages to update durable knowledge about projects, people, decisions, blockers, owners, deadlines, and status changes.',
        filters: {
          limit: 100,
          maxBodyChars: 4000,
          recentBackfillSeconds: 6 * 60 * 60,
        },
      })
      toast.success('Slack knowledge source saved')
      await refreshKnowledgeSources()
    } catch (error) {
      console.error('Failed to save Slack knowledge source:', error)
      toast.error('Failed to save Slack knowledge source')
    } finally {
      setSlackKnowledgeSaving(false)
    }
  }, [parseSlackKnowledgeScopes, refreshKnowledgeSources, slackKnowledgeEnabled])

  // Gmail (Composio)
  const refreshGmailStatus = useCallback(async () => {
    try {
      setGmailLoading(true)
      const result = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: 'gmail' })
      setGmailConnected(result.isConnected)
    } catch (error) {
      console.error('Failed to load Gmail status:', error)
      setGmailConnected(false)
    } finally {
      setGmailLoading(false)
    }
  }, [])

  const startGmailConnect = useCallback(async () => {
    try {
      setGmailConnecting(true)
      const result = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: 'gmail' })
      if (!result.success) {
        toast.error(result.error || 'Failed to connect to Gmail')
        setGmailConnecting(false)
      }
    } catch (error) {
      console.error('Failed to connect to Gmail:', error)
      toast.error('Failed to connect to Gmail')
      setGmailConnecting(false)
    }
  }, [])

  const handleConnectGmail = useCallback(async () => {
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyTarget('gmail')
      setComposioApiKeyOpen(true)
      return
    }
    await startGmailConnect()
  }, [startGmailConnect])

  const handleDisconnectGmail = useCallback(async () => {
    try {
      setGmailLoading(true)
      const result = await window.ipc.invoke('composio:disconnect', { toolkitSlug: 'gmail' })
      if (result.success) {
        setGmailConnected(false)
        toast.success('Disconnected from Gmail')
      } else {
        toast.error('Failed to disconnect from Gmail')
      }
    } catch (error) {
      console.error('Failed to disconnect from Gmail:', error)
      toast.error('Failed to disconnect from Gmail')
    } finally {
      setGmailLoading(false)
    }
  }, [])

  // Google Calendar (Composio)
  const refreshGoogleCalendarStatus = useCallback(async () => {
    try {
      setGoogleCalendarLoading(true)
      const result = await window.ipc.invoke('composio:get-connection-status', { toolkitSlug: 'googlecalendar' })
      setGoogleCalendarConnected(result.isConnected)
    } catch (error) {
      console.error('Failed to load Google Calendar status:', error)
      setGoogleCalendarConnected(false)
    } finally {
      setGoogleCalendarLoading(false)
    }
  }, [])

  const startGoogleCalendarConnect = useCallback(async () => {
    try {
      setGoogleCalendarConnecting(true)
      const result = await window.ipc.invoke('composio:initiate-connection', { toolkitSlug: 'googlecalendar' })
      if (!result.success) {
        toast.error(result.error || 'Failed to connect to Google Calendar')
        setGoogleCalendarConnecting(false)
      }
    } catch (error) {
      console.error('Failed to connect to Google Calendar:', error)
      toast.error('Failed to connect to Google Calendar')
      setGoogleCalendarConnecting(false)
    }
  }, [])

  const handleConnectGoogleCalendar = useCallback(async () => {
    const configResult = await window.ipc.invoke('composio:is-configured', null)
    if (!configResult.configured) {
      setComposioApiKeyTarget('gmail')
      setComposioApiKeyOpen(true)
      return
    }
    await startGoogleCalendarConnect()
  }, [startGoogleCalendarConnect])

  const handleDisconnectGoogleCalendar = useCallback(async () => {
    try {
      setGoogleCalendarLoading(true)
      const result = await window.ipc.invoke('composio:disconnect', { toolkitSlug: 'googlecalendar' })
      if (result.success) {
        setGoogleCalendarConnected(false)
        toast.success('Disconnected from Google Calendar')
      } else {
        toast.error('Failed to disconnect from Google Calendar')
      }
    } catch (error) {
      console.error('Failed to disconnect from Google Calendar:', error)
      toast.error('Failed to disconnect from Google Calendar')
    } finally {
      setGoogleCalendarLoading(false)
    }
  }, [])

  // Composio API key
  const handleComposioApiKeySubmit = useCallback(async (apiKey: string) => {
    try {
      await window.ipc.invoke('composio:set-api-key', { apiKey })
      setComposioApiKeyOpen(false)
      toast.success('Composio API key saved')
      await startGmailConnect()
    } catch (error) {
      console.error('Failed to save Composio API key:', error)
      toast.error('Failed to save API key')
    }
  }, [startGmailConnect])

  // OAuth connect/disconnect
  const startConnect = useCallback(async (provider: string, credentials?: { clientId: string; clientSecret: string }) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isConnecting: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:connect', { provider, clientId: credentials?.clientId, clientSecret: credentials?.clientSecret })

      if (!result.success) {
        toast.error(result.error || (provider === 'rowboat' ? 'Failed to log in to Rowboat' : `Failed to connect to ${provider}`))
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isConnecting: false }
        }))
      }
    } catch (error) {
      console.error('Failed to connect:', error)
      toast.error(provider === 'rowboat' ? 'Failed to log in to Rowboat' : `Failed to connect to ${provider}`)
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isConnecting: false }
      }))
    }
  }, [])

  const handleConnect = useCallback(async (provider: string) => {
    if (provider === 'google') {
      // Signed-in users use the rowboat (managed-credentials) flow: opens
      // the webapp in the browser, no BYOK modal. Main process detects
      // signed-in via isSignedIn() when oauth:connect arrives without creds.
      // Falls back to the BYOK modal for not-signed-in users.
      const isSignedIntoRowboat = providerStates.rowboat?.isConnected ?? false
      if (isSignedIntoRowboat) {
        await startConnect('google')
        return
      }
      setGoogleClientIdDescription(undefined)
      setGoogleClientIdOpen(true)
      return
    }

    await startConnect(provider)
  }, [startConnect, providerStates])

  const handleGoogleClientIdSubmit = useCallback((clientId: string, clientSecret: string) => {
    setGoogleCredentials(clientId, clientSecret)
    setGoogleClientIdOpen(false)
    setGoogleClientIdDescription(undefined)
    startConnect('google', { clientId, clientSecret })
  }, [startConnect])

  // Reconnect flow used by the "Reconnect" button. Mirrors handleConnect's
  // rowboat-vs-BYOK branching for Google so signed-in users don't get the
  // client-ID modal — they just re-run the managed-credentials browser flow.
  const handleReconnect = useCallback(async (provider: string) => {
    if (provider === 'google') {
      const isSignedIntoRowboat = providerStates.rowboat?.isConnected ?? false
      if (isSignedIntoRowboat) {
        await startConnect('google')
        return
      }
      setGoogleClientIdDescription(
        "To keep your Google account connected, please re-enter your client ID. You only need to do this once."
      )
      setGoogleClientIdOpen(true)
      return
    }
    await startConnect(provider)
  }, [startConnect, providerStates])

  const handleDisconnect = useCallback(async (provider: string) => {
    setProviderStates(prev => ({
      ...prev,
      [provider]: { ...prev[provider], isLoading: true }
    }))

    try {
      const result = await window.ipc.invoke('oauth:disconnect', { provider })

      if (result.success) {
        if (provider === 'google') {
          clearGoogleCredentials()
        }
        const displayName = provider === 'fireflies-ai' ? 'Fireflies' : provider.charAt(0).toUpperCase() + provider.slice(1)
        toast.success(provider === 'rowboat' ? 'Logged out of Rowboat' : `Disconnected from ${displayName}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: {
            isConnected: false,
            isLoading: false,
            isConnecting: false,
          }
        }))
      } else {
        toast.error(provider === 'rowboat' ? 'Failed to log out of Rowboat' : `Failed to disconnect from ${provider}`)
        setProviderStates(prev => ({
          ...prev,
          [provider]: { ...prev[provider], isLoading: false }
        }))
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
      toast.error(provider === 'rowboat' ? 'Failed to log out of Rowboat' : `Failed to disconnect from ${provider}`)
      setProviderStates(prev => ({
        ...prev,
        [provider]: { ...prev[provider], isLoading: false }
      }))
    }
  }, [])

  // Refresh all statuses
  const refreshAllStatuses = useCallback(async () => {
    refreshGranolaConfig()
    refreshSlackConfig()
    refreshKnowledgeSources()
    refreshSlackKnowledgeStatus()

    if (useComposioForGoogle) {
      refreshGmailStatus()
    }

    if (useComposioForGoogleCalendar) {
      refreshGoogleCalendarStatus()
    }

    if (providers.length === 0) return

    const newStates: Record<string, ProviderState> = {}

    try {
      const result = await window.ipc.invoke('oauth:getState', null)
      const config = result.config || {}
      const statusMap: Record<string, ProviderStatus> = {}

      for (const provider of providers) {
        const providerConfig = config[provider]
        newStates[provider] = {
          isConnected: providerConfig?.connected ?? false,
          isLoading: false,
          isConnecting: false,
        }
        if (providerConfig?.error) {
          statusMap[provider] = { error: providerConfig.error }
        }
      }

      setProviderStatus(statusMap)
    } catch (error) {
      console.error('Failed to check connection statuses:', error)
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: false,
          isLoading: false,
          isConnecting: false,
        }
      }
      setProviderStatus({})
    }

    setProviderStates(newStates)
  }, [providers, refreshGranolaConfig, refreshSlackConfig, refreshKnowledgeSources, refreshSlackKnowledgeStatus, refreshGmailStatus, useComposioForGoogle, refreshGoogleCalendarStatus, useComposioForGoogleCalendar])

  // Refresh when active or providers change
  useEffect(() => {
    if (active) {
      refreshAllStatuses()
    }
  }, [active, providers, refreshAllStatuses])

  // Listen for OAuth events
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', async (event) => {
      const { provider, success } = event

      setProviderStates(prev => ({
        ...prev,
        [provider]: {
          isConnected: success,
          isLoading: false,
          isConnecting: false,
        }
      }))

      if (success) {
        const displayName = provider === 'fireflies-ai' ? 'Fireflies' : provider.charAt(0).toUpperCase() + provider.slice(1)
        if (provider === 'rowboat') {
          toast.success('Logged in to Rowboat')
        } else if (provider === 'google' || provider === 'fireflies-ai') {
          toast.success(`Connected to ${displayName}`, {
            description: 'Syncing your data in the background. This may take a few minutes before changes appear.',
            duration: 8000,
          })
        } else {
          toast.success(`Connected to ${displayName}`)
        }

        refreshAllStatuses()
      }
    })

    return cleanup
  }, [refreshAllStatuses])

  // Listen for Composio events
  useEffect(() => {
    const cleanup = window.ipc.on('composio:didConnect', (event) => {
      const { toolkitSlug, success, error } = event

      if (toolkitSlug === 'gmail') {
        setGmailConnected(success)
        setGmailConnecting(false)

        if (success) {
          toast.success('Connected to Gmail', {
            description: 'Syncing your emails in the background. This may take a few minutes before changes appear.',
            duration: 8000,
          })
        } else {
          toast.error(error || 'Failed to connect to Gmail')
        }
      }

      if (toolkitSlug === 'googlecalendar') {
        setGoogleCalendarConnected(success)
        setGoogleCalendarConnecting(false)

        if (success) {
          toast.success('Connected to Google Calendar', {
            description: 'Syncing your calendar in the background. This may take a few minutes before changes appear.',
            duration: 8000,
          })
        } else {
          toast.error(error || 'Failed to connect to Google Calendar')
        }
      }
    })

    return cleanup
  }, [])

  const hasProviderError = Object.values(providerStatus).some(
    (status) => Boolean(status?.error)
  )

  return {
    // OAuth providers
    providers,
    providersLoading,
    providerStates,
    providerStatus,
    hasProviderError,
    handleConnect,
    handleReconnect,
    handleDisconnect,
    startConnect,

    // Google credentials modal
    googleClientIdOpen,
    setGoogleClientIdOpen,
    googleClientIdDescription,
    setGoogleClientIdDescription,
    handleGoogleClientIdSubmit,

    // Granola
    granolaEnabled,
    granolaLoading,
    handleGranolaToggle,

    // Composio API key modal
    composioApiKeyOpen,
    setComposioApiKeyOpen,
    composioApiKeyTarget,
    setComposioApiKeyTarget,
    handleComposioApiKeySubmit,

    // Slack
    slackEnabled,
    slackLoading,
    slackWorkspaces,
    slackAvailableWorkspaces,
    slackSelectedUrls,
    setSlackSelectedUrls,
    slackPickerOpen,
    setSlackPickerOpen,
    slackDiscovering,
    slackDiscoverError,
    slackNeedsAuth,
    slackAuthImporting,
    slackCurlOpen,
    setSlackCurlOpen,
    slackCurlValue,
    setSlackCurlValue,
    slackCurlSubmitting,
    slackSyncStatuses,
    slackKnowledgeEnabled,
    setSlackKnowledgeEnabled,
    slackKnowledgeChannels,
    setSlackKnowledgeChannels,
    slackKnowledgeSaving,
    handleSlackEnable,
    handleSlackImportDesktop,
    handleSlackQuitAndImport,
    handleSlackParseCurl,
    handleSlackSaveWorkspaces,
    handleSlackDisable,
    handleSlackKnowledgeSave,

    // Gmail (Composio)
    useComposioForGoogle,
    gmailConnected,
    gmailLoading,
    gmailConnecting,
    handleConnectGmail,
    handleDisconnectGmail,

    // Google Calendar (Composio)
    useComposioForGoogleCalendar,
    googleCalendarConnected,
    googleCalendarLoading,
    googleCalendarConnecting,
    handleConnectGoogleCalendar,
    handleDisconnectGoogleCalendar,

    // Refresh
    refreshAllStatuses,
  }
}
