import { Loader2, CheckCircle2, ArrowLeft, Calendar } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { GmailIcon, SlackIcon, FirefliesIcon, GranolaIcon } from "../provider-icons"
import type { OnboardingState, ProviderState } from "../use-onboarding-state"

interface ConnectAccountsStepProps {
  state: OnboardingState
}

function ProviderCard({
  name,
  description,
  icon,
  iconBg,
  iconColor,
  providerState,
  onConnect,
  rightSlot,
  index,
}: {
  name: string
  description: string
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  providerState?: ProviderState
  onConnect?: () => void
  rightSlot?: React.ReactNode
  index: number
}) {
  const isConnected = providerState?.isConnected ?? false

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors",
        isConnected
          ? "border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10"
          : "hover:bg-muted/50"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("size-10 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
          <span className={iconColor}>{icon}</span>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">{name}</div>
          <div className="text-xs text-muted-foreground truncate">{description}</div>
        </div>
      </div>
      <div className="shrink-0">
        {rightSlot ?? (
          providerState?.isLoading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : isConnected ? (
            <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-4" />
              <span className="font-medium">Connected</span>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={onConnect}
              disabled={providerState?.isConnecting}
            >
              {providerState?.isConnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Connect"
              )}
            </Button>
          )
        )}
      </div>
    </motion.div>
  )
}

export function ConnectAccountsStep({ state }: ConnectAccountsStepProps) {
  const {
    providers, providersLoading, providerStates, handleConnect,
    granolaEnabled, granolaLoading, handleGranolaToggle,
    slackEnabled, slackLoading, slackWorkspaces, slackAvailableWorkspaces,
    slackSelectedUrls, setSlackSelectedUrls, slackPickerOpen,
    slackDiscovering, slackDiscoverError,
    handleSlackEnable, handleSlackSaveWorkspaces, handleSlackDisable,
    useComposioForGoogle, gmailConnected, gmailLoading, gmailConnecting, handleConnectGmail,
    useComposioForGoogleCalendar, googleCalendarConnected, googleCalendarLoading, googleCalendarConnecting, handleConnectGoogleCalendar,
    handleNext, handleBack,
  } = state

  let cardIndex = 0

  return (
    <div className="flex flex-col flex-1">
      {/* Title */}
      <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
        Connect Your Accounts
      </h2>
      <p className="text-base text-muted-foreground text-center leading-relaxed mb-8">
        Connect your accounts to give Rowboat context about your work. You can always add more later.
      </p>

      {providersLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Email & Calendar */}
          {(useComposioForGoogle || useComposioForGoogleCalendar || providers.includes('google')) && (
            <div className="space-y-3">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Email & Calendar
              </span>
              {useComposioForGoogle ? (
                <ProviderCard
                  name="Gmail"
                  description="Sync your email for context-aware assistance"
                  icon={<GmailIcon />}
                  iconBg="bg-red-500/10"
                  iconColor="text-red-500"
                  providerState={{ isConnected: gmailConnected, isLoading: gmailLoading, isConnecting: gmailConnecting }}
                  onConnect={handleConnectGmail}
                  index={cardIndex++}
                />
              ) : (
                <ProviderCard
                  name="Google"
                  description="Rowboat uses your email and calendar to provide personalized, context-aware assistance"
                  icon={<GmailIcon />}
                  iconBg="bg-red-500/10"
                  iconColor="text-red-500"
                  providerState={providerStates['google']}
                  onConnect={() => handleConnect('google')}
                  index={cardIndex++}
                />
              )}
              {useComposioForGoogleCalendar && (
                <ProviderCard
                  name="Google Calendar"
                  description="Sync calendar events for scheduling awareness"
                  icon={<Calendar className="size-5" />}
                  iconBg="bg-blue-500/10"
                  iconColor="text-blue-500"
                  providerState={{ isConnected: googleCalendarConnected, isLoading: googleCalendarLoading, isConnecting: googleCalendarConnecting }}
                  onConnect={handleConnectGoogleCalendar}
                  index={cardIndex++}
                />
              )}
            </div>
          )}

          {/* Meeting Notes */}
          <div className="space-y-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Meeting Notes
            </span>
            <ProviderCard
              name="Granola"
              description="Sync your local meeting notes for richer context"
              icon={<GranolaIcon />}
              iconBg="bg-purple-500/10"
              iconColor="text-purple-500"
              providerState={{ isConnected: granolaEnabled, isLoading: false, isConnecting: false }}
              rightSlot={
                <div className="flex items-center gap-2">
                  {granolaLoading && <Loader2 className="size-3 animate-spin" />}
                  <Switch
                    checked={granolaEnabled}
                    onCheckedChange={handleGranolaToggle}
                    disabled={granolaLoading}
                  />
                </div>
              }
              index={cardIndex++}
            />
            {providers.includes('fireflies-ai') && (
              <ProviderCard
                name="Fireflies"
                description="Import AI-powered meeting transcripts automatically"
                icon={<FirefliesIcon />}
                iconBg="bg-amber-500/10"
                iconColor="text-amber-500"
                providerState={providerStates['fireflies-ai']}
                onConnect={() => handleConnect('fireflies-ai')}
                index={cardIndex++}
              />
            )}
          </div>

          {/* Team Communication */}
          <div className="space-y-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Team Communication
            </span>
            <div>
              <ProviderCard
                name="Slack"
                description={
                  slackEnabled && slackWorkspaces.length > 0
                    ? slackWorkspaces.map(w => w.name).join(', ')
                    : "Enable Rowboat to understand your team conversations and provide relevant context"
                }
                icon={<SlackIcon />}
                iconBg="bg-emerald-500/10"
                iconColor="text-emerald-500"
                providerState={{ isConnected: slackEnabled, isLoading: false, isConnecting: false }}
                rightSlot={
                  <div className="flex items-center gap-2">
                    {(slackLoading || slackDiscovering) && <Loader2 className="size-3 animate-spin" />}
                    {slackEnabled ? (
                      <Switch
                        checked={true}
                        onCheckedChange={() => handleSlackDisable()}
                        disabled={slackLoading}
                      />
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleSlackEnable}
                        disabled={slackLoading || slackDiscovering}
                      >
                        Enable
                      </Button>
                    )}
                  </div>
                }
                index={cardIndex++}
              />
              {slackPickerOpen && (
                <div className="mt-2 ml-[3.25rem] space-y-2 pl-4 border-l-2 border-muted">
                  {slackDiscoverError ? (
                    <p className="text-xs text-muted-foreground">{slackDiscoverError}</p>
                  ) : (
                    <>
                      {slackAvailableWorkspaces.map(w => (
                        <label key={w.url} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={slackSelectedUrls.has(w.url)}
                            onChange={(e) => {
                              setSlackSelectedUrls(prev => {
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
                        onClick={handleSlackSaveWorkspaces}
                        disabled={slackSelectedUrls.size === 0 || slackLoading}
                      >
                        Save
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-col gap-3 mt-8 pt-4 border-t">
        <Button onClick={handleNext} size="lg" className="h-12 text-base font-medium">
          Continue
        </Button>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} className="gap-1">
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleNext} className="text-muted-foreground">
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  )
}
