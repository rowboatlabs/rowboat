"use client"

import * as React from "react"
import { Loader2, Calendar } from "lucide-react"
import { FirefliesIcon, GoogleIcon, SlackIcon } from "@/components/onboarding/provider-icons"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { GoogleClientIdModal } from "@/components/google-client-id-modal"
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal"
import { useConnectors, actionableSlackError } from "@/hooks/useConnectors"

interface ConnectedAccountsSettingsProps {
  dialogOpen: boolean
}

function relativeTime(iso?: string): string {
  if (!iso) return "never"
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return "never"
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.round(diffHr / 24)}d ago`
}

export function ConnectedAccountsSettings({ dialogOpen }: ConnectedAccountsSettingsProps) {
  const c = useConnectors(dialogOpen)
  // Windows exclusively locks Slack's Cookies DB while it runs, so we offer a
  // "quit Slack first" one-click import there. mac/Linux import with Slack open.
  const isWindows = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')

  const renderOAuthProvider = (provider: string, displayName: string, icon: React.ReactNode, description: string) => {
    const state = c.providerStates[provider] || {
      isConnected: false,
      isLoading: true,
      isConnecting: false,
    }
    const needsReconnect = Boolean(c.providerStatus[provider]?.error)

    return (
      <div
        key={provider}
        className="flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {icon}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium truncate">{displayName}</span>
            {state.isLoading ? (
              <span className="text-xs text-muted-foreground">Checking...</span>
            ) : needsReconnect ? (
              <span className="text-xs text-amber-600">Needs reconnect</span>
            ) : state.isConnected ? (
              <span className="text-xs text-emerald-600">Connected</span>
            ) : (
              <span className="text-xs text-muted-foreground truncate">{description}</span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {state.isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : needsReconnect ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => c.handleReconnect(provider)}
              className="h-7 px-3 text-xs"
            >
              Reconnect
            </Button>
          ) : state.isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => c.handleDisconnect(provider)}
              className="h-7 px-3 text-xs"
            >
              Disconnect
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={() => c.handleConnect(provider)}
              disabled={state.isConnecting}
              className="h-7 px-3 text-xs"
            >
              {state.isConnecting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (c.providersLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <>
      <GoogleClientIdModal
        open={c.googleClientIdOpen}
        onOpenChange={(nextOpen) => {
          c.setGoogleClientIdOpen(nextOpen)
          if (!nextOpen) {
            c.setGoogleClientIdDescription(undefined)
          }
        }}
        onSubmit={c.handleGoogleClientIdSubmit}
        isSubmitting={c.providerStates.google?.isConnecting ?? false}
        description={c.googleClientIdDescription}
      />
      <ComposioApiKeyModal
        open={c.composioApiKeyOpen}
        onOpenChange={c.setComposioApiKeyOpen}
        onSubmit={c.handleComposioApiKeySubmit}
        isSubmitting={c.gmailConnecting}
      />

      <div className="space-y-1">
        {/* Email & Calendar Section */}
        {(c.useComposioForGoogle || c.useComposioForGoogleCalendar || c.providers.includes('google')) && (
          <>
            <div className="px-3 pt-1 pb-0.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email & Calendar
              </span>
            </div>
            {c.useComposioForGoogle ? (
              <div className="flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0">
                  <GoogleIcon className="size-5 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">Gmail</span>
                    {c.gmailLoading ? (
                      <span className="text-xs text-muted-foreground">Checking...</span>
                    ) : c.gmailConnected ? (
                      <span className="text-xs text-emerald-600">Connected</span>
                    ) : (
                      <span className="text-xs text-muted-foreground truncate">Sync emails</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  {c.gmailLoading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : c.gmailConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={c.handleDisconnectGmail}
                      className="h-7 px-3 text-xs"
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={c.handleConnectGmail}
                      disabled={c.gmailConnecting}
                      className="h-7 px-3 text-xs"
                    >
                      {c.gmailConnecting ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        "Connect"
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              c.providers.includes('google') && renderOAuthProvider('google', 'Google', <GoogleIcon className="size-5" />, 'Sync emails and calendar')
            )}
            {c.useComposioForGoogleCalendar && (
              <div className="flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Calendar className="size-5 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">Google Calendar</span>
                    {c.googleCalendarLoading ? (
                      <span className="text-xs text-muted-foreground">Checking...</span>
                    ) : c.googleCalendarConnected ? (
                      <span className="text-xs text-emerald-600">Connected</span>
                    ) : (
                      <span className="text-xs text-muted-foreground truncate">Sync calendar events</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  {c.googleCalendarLoading ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : c.googleCalendarConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={c.handleDisconnectGoogleCalendar}
                      className="h-7 px-3 text-xs"
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={c.handleConnectGoogleCalendar}
                      disabled={c.googleCalendarConnecting}
                      className="h-7 px-3 text-xs"
                    >
                      {c.googleCalendarConnecting ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        "Connect"
                      )}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Meeting Notes Section */}
        {c.providers.includes('fireflies-ai') && (
          <>
            <div className="px-3 pt-1 pb-0.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Meeting Notes
              </span>
            </div>

            {/* Fireflies */}
            {renderOAuthProvider('fireflies-ai', 'Fireflies', <FirefliesIcon className="size-5" />, 'AI meeting transcripts')}
          </>
        )}

        {/* Team Communication Section */}
        <>
          <div className="px-3 pt-3 pb-0.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Team Communication
            </span>
          </div>
          <div className="rounded-md px-3 py-2 hover:bg-accent/50 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <SlackIcon className="size-5 shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">Slack</span>
                  {c.slackLoading ? (
                    <span className="text-xs text-muted-foreground">Checking...</span>
                  ) : c.slackEnabled && c.slackWorkspaces.length > 0 ? (
                    <span className="text-xs text-emerald-600 truncate">
                      {c.slackWorkspaces.map(workspace => workspace.name).join(', ')}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground truncate">Send messages and view channels</span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {c.slackLoading || c.slackDiscovering ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : c.slackEnabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={c.handleSlackDisable}
                    className="h-7 px-3 text-xs"
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={c.handleSlackEnable}
                    className="h-7 px-3 text-xs"
                  >
                    Enable
                  </Button>
                )}
              </div>
            </div>
            {c.slackPickerOpen && (
              <div className="mt-2 ml-10 space-y-2">
                {c.slackNeedsAuth ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {c.slackDiscoverError ?? 'Connect your signed-in Slack desktop app to continue.'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Button
                        size="sm"
                        onClick={c.handleSlackImportDesktop}
                        disabled={c.slackAuthImporting}
                        className="h-7 px-3 text-xs"
                      >
                        {c.slackAuthImporting ? <Loader2 className="size-3 animate-spin" /> : "Connect Slack"}
                      </Button>
                      {isWindows && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={c.handleSlackQuitAndImport}
                          disabled={c.slackAuthImporting}
                          className="h-7 px-3 text-xs"
                          title="Closes Slack so its data unlocks, then connects"
                        >
                          Quit Slack &amp; connect
                        </Button>
                      )}
                      <button
                        type="button"
                        onClick={() => c.setSlackCurlOpen(!c.slackCurlOpen)}
                        className="text-xs text-primary underline-offset-2 hover:underline"
                      >
                        Paste from browser instead
                      </button>
                    </div>
                    {c.slackCurlOpen && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          In a browser signed in to Slack, open DevTools → Network, click any
                          request to <code>app.slack.com</code>, right-click → Copy → Copy as cURL,
                          then paste it below.
                        </p>
                        <Textarea
                          value={c.slackCurlValue}
                          onChange={(event) => c.setSlackCurlValue(event.target.value)}
                          placeholder="curl 'https://your-team.slack.com/api/...' -H 'Cookie: d=xoxd-...' ..."
                          className="min-h-20 text-[11px] font-mono"
                          disabled={c.slackCurlSubmitting}
                        />
                        <Button
                          size="sm"
                          onClick={c.handleSlackParseCurl}
                          disabled={c.slackCurlSubmitting || c.slackCurlValue.trim().length === 0}
                          className="h-7 px-3 text-xs"
                        >
                          {c.slackCurlSubmitting ? <Loader2 className="size-3 animate-spin" /> : "Connect with cURL"}
                        </Button>
                      </div>
                    )}
                  </>
                ) : c.slackDiscoverError ? (
                  <p className="text-xs text-muted-foreground">{c.slackDiscoverError}</p>
                ) : (
                  <>
                    {c.slackAvailableWorkspaces.map(workspace => (
                      <label key={workspace.url} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={c.slackSelectedUrls.has(workspace.url)}
                          onChange={(event) => {
                            c.setSlackSelectedUrls(prev => {
                              const next = new Set(prev)
                              if (event.target.checked) next.add(workspace.url)
                              else next.delete(workspace.url)
                              return next
                            })
                          }}
                          className="rounded border-border"
                        />
                        <span className="truncate">{workspace.name}</span>
                      </label>
                    ))}
                    <Button
                      size="sm"
                      onClick={c.handleSlackSaveWorkspaces}
                      disabled={c.slackSelectedUrls.size === 0 || c.slackLoading}
                      className="h-7 px-3 text-xs"
                    >
                      Save
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </>

        {/* Knowledge Sources Section */}
        {c.slackEnabled && (
          <>
            <div className="px-3 pt-3 pb-0.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Knowledge Sources
              </span>
            </div>
            <div className="rounded-md px-3 py-2 hover:bg-accent/50 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <SlackIcon className="size-5 shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate">Slack to knowledge</span>
                    <span className="text-xs text-muted-foreground truncate">
                      Sync selected channels into the knowledge graph
                    </span>
                  </div>
                </div>
                <Switch
                  checked={c.slackKnowledgeEnabled}
                  onCheckedChange={c.setSlackKnowledgeEnabled}
                  disabled={c.slackKnowledgeSaving}
                />
              </div>
              <div className="mt-2 space-y-2">
                <Textarea
                  value={c.slackKnowledgeChannels}
                  onChange={(event) => c.setSlackKnowledgeChannels(event.target.value)}
                  placeholder={c.slackWorkspaces.length > 1 ? "https://team.slack.com #engineering" : "#engineering"}
                  className="min-h-20 text-xs"
                  disabled={!c.slackKnowledgeEnabled || c.slackKnowledgeSaving}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    One channel per line. Use channel names or IDs.
                  </span>
                  {(c.slackKnowledgeDirty || c.slackKnowledgeSaving) && (
                    <Button
                      size="sm"
                      onClick={c.handleSlackKnowledgeSave}
                      disabled={c.slackKnowledgeSaving || (c.slackKnowledgeEnabled && c.slackKnowledgeChannels.trim().length === 0)}
                      className="h-7 px-3 text-xs"
                    >
                      {c.slackKnowledgeSaving ? <Loader2 className="size-3 animate-spin" /> : "Save"}
                    </Button>
                  )}
                </div>
                {c.slackKnowledgeEnabled && c.slackSyncStatuses.filter(s => s.enabled).map(status => (
                  <div key={status.id} className="flex items-center gap-1.5 text-xs">
                    {status.lastStatus === 'error' ? (
                      <span className="text-amber-600 truncate">
                        Sync failing — {actionableSlackError(status.lastError?.kind, status.lastError?.message)}
                      </span>
                    ) : status.lastSyncAt ? (
                      <span className="text-muted-foreground">Last synced {relativeTime(status.lastSyncAt)}</span>
                    ) : (
                      <span className="text-muted-foreground">Not synced yet — first sync runs shortly</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
