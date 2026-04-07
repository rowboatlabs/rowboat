import { Loader2, CheckCircle2, ArrowLeft, Calendar, FileText } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { GmailIcon, FirefliesIcon } from "../provider-icons"
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
        Rowboat gets smarter the more it knows about your work. Connect your accounts to get started. You can find more tools in Settings.
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
                  description="Read emails for context and drafts."
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
                  description="Read meetings and your schedule."
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
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: cardIndex++ * 0.06 }}
              className="flex items-center justify-between gap-4 rounded-xl border border-green-200 bg-green-50/50 dark:border-green-800/50 dark:bg-green-900/10 p-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-10 rounded-lg flex items-center justify-center shrink-0 bg-green-500/10">
                  <span className="text-green-500"><FileText className="size-5" /></span>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Rowboat Meeting Notes</div>
                  <div className="text-xs text-muted-foreground truncate">Built in. Ready to use.</div>
                </div>
              </div>
              <div className="shrink-0">
                <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                  <CheckCircle2 className="size-4" />
                </div>
              </div>
            </motion.div>
            {providers.includes('fireflies-ai') && (
              <ProviderCard
                name="Fireflies"
                description="Import existing notes."
                icon={<FirefliesIcon />}
                iconBg="bg-amber-500/10"
                iconColor="text-amber-500"
                providerState={providerStates['fireflies-ai']}
                onConnect={() => handleConnect('fireflies-ai')}
                index={cardIndex++}
              />
            )}
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
