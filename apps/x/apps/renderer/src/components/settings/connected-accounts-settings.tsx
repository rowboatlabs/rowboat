"use client"

import * as React from "react"
import { Loader2, Mic, Mail, Calendar, MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { GoogleClientIdModal } from "@/components/google-client-id-modal"
import { ComposioApiKeyModal } from "@/components/composio-api-key-modal"
import { useConnectors } from "@/hooks/useConnectors"

interface ConnectedAccountsSettingsProps {
  dialogOpen: boolean
}

export function ConnectedAccountsSettings({ dialogOpen }: ConnectedAccountsSettingsProps) {
  const c = useConnectors(dialogOpen)

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
        className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            {icon}
          </div>
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
              onClick={() => {
                if (provider === 'google') {
                  c.setGoogleClientIdDescription(
                    "To keep your Google account connected, please re-enter your client ID. You only need to do this once."
                  )
                  c.setGoogleClientIdOpen(true)
                  return
                }
                c.startConnect(provider)
              }}
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
            <div className="px-4 py-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Email & Calendar
              </span>
            </div>
            {c.useComposioForGoogle ? (
              <div className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <Mail className="size-4" />
                  </div>
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
              c.providers.includes('google') && renderOAuthProvider('google', 'Google', <Mail className="size-4" />, 'Sync emails and calendar')
            )}
            {c.useComposioForGoogleCalendar && (
              <div className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                    <Calendar className="size-4" />
                  </div>
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
            <Separator className="my-3" />
          </>
        )}

        {/* Meeting Notes Section */}
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Meeting Notes
          </span>
        </div>

        {/* Granola */}
        <div className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <Mic className="size-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">Granola</span>
              <span className="text-xs text-muted-foreground truncate">
                Local meeting notes
              </span>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {c.granolaLoading && (
              <Loader2 className="size-3 animate-spin" />
            )}
            <Switch
              checked={c.granolaEnabled}
              onCheckedChange={c.handleGranolaToggle}
              disabled={c.granolaLoading}
            />
          </div>
        </div>

        {/* Fireflies */}
        {c.providers.includes('fireflies-ai') && renderOAuthProvider('fireflies-ai', 'Fireflies', <Mic className="size-4" />, 'AI meeting transcripts')}

        <Separator className="my-3" />

        {/* Team Communication Section */}
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Team Communication
          </span>
        </div>

        {/* Slack */}
        <div className="rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                <MessageSquare className="size-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">Slack</span>
                {c.slackEnabled && c.slackWorkspaces.length > 0 ? (
                  <span className="text-xs text-emerald-600 truncate">
                    {c.slackWorkspaces.map(w => w.name).join(', ')}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground truncate">
                    Send messages and view channels
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {(c.slackLoading || c.slackDiscovering) && (
                <Loader2 className="size-3 animate-spin" />
              )}
              {c.slackEnabled ? (
                <Switch
                  checked={true}
                  onCheckedChange={() => c.handleSlackDisable()}
                  disabled={c.slackLoading}
                />
              ) : (
                <Button
                  variant="default"
                  size="sm"
                  onClick={c.handleSlackEnable}
                  disabled={c.slackLoading || c.slackDiscovering}
                  className="h-7 px-3 text-xs"
                >
                  Enable
                </Button>
              )}
            </div>
          </div>
          {c.slackPickerOpen && (
            <div className="mt-2 ml-12 space-y-2">
              {c.slackDiscoverError ? (
                <p className="text-xs text-muted-foreground">{c.slackDiscoverError}</p>
              ) : (
                <>
                  {c.slackAvailableWorkspaces.map(w => (
                    <label key={w.url} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={c.slackSelectedUrls.has(w.url)}
                        onChange={(e) => {
                          c.setSlackSelectedUrls(prev => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(w.url)
                            else next.delete(w.url)
                            return next
                          })
                        }}
                        className="rounded border-border"
                      />
                      <span className="truncate">{w.name}</span>
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
      </div>
    </>
  )
}
