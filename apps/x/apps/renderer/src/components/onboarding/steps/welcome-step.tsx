import { Loader2, CheckCircle2 } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { useChatGPT } from "@/hooks/useChatGPT"
import { OpenAIIcon } from "../provider-icons"
import type { OnboardingState } from "../use-onboarding-state"

interface WelcomeStepProps {
  state: OnboardingState
}

export function WelcomeStep({ state }: WelcomeStepProps) {
  const chatgpt = useChatGPT()
  const rowboatState = state.providerStates['rowboat'] || { isConnected: false, isLoading: false, isConnecting: false }

  const isConnecting = rowboatState.isConnecting || chatgpt.isSigningIn
  const canContinue = rowboatState.isConnected || chatgpt.status.signedIn
  const accounts = [
    {
      id: "rowboat",
      name: "Rowboat",
      description: "Free plan included. Models from OpenAI, Anthropic, Google and more.",
      icon: <img src="/logo-only.png" alt="" className="size-7" />,
      connected: rowboatState.isConnected,
      loading: state.providersLoading || rowboatState.isLoading,
      connecting: rowboatState.isConnecting,
      signIn: () => state.startConnect("rowboat"),
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      description: "Use your Plus or Pro subscription with your existing ChatGPT login.",
      icon: <OpenAIIcon className="size-6" />,
      connected: chatgpt.status.signedIn,
      loading: chatgpt.isLoading,
      connecting: chatgpt.isSigningIn,
      signIn: chatgpt.signIn,
    },
  ]

  return (
    <div className="flex flex-col items-center justify-center text-center flex-1">
      {/* Logo + main heading on the same level */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex items-center gap-4 mb-4"
      >
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome to Rowboat
        </h1>
        {/* Logo with ambient glow */}
        <div className="relative shrink-0">
          <div className="absolute inset-0 size-12 rounded-2xl bg-primary/10 blur-xl scale-[2.5]" />
          <img src="/logo-only.png" alt="Rowboat" className="relative size-12" />
        </div>
      </motion.div>

      {/* Tagline badge */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-muted-foreground mb-6"
      >
        <span className="size-1.5 rounded-full bg-[var(--rowboat-success)] animate-pulse" />
        The multiplayer personal assistant for work
      </motion.div>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-base text-muted-foreground leading-relaxed max-w-sm mb-6"
      >
        Rowboat connects to your work, builds a knowledge graph, and works alongside your team and their assistants. Private and on your machine.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="w-full max-w-lg space-y-3"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Sign in to get started. Connect both for more models.
        </p>
        {accounts.map(account => (
          <div key={account.id} className="rounded-xl border bg-muted/20 p-4 text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted" aria-hidden="true">
                {account.icon}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-medium">{account.name}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{account.description}</p>
              </div>
              {account.connected ? (
                <span role="status" className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--rowboat-success)]">
                  <CheckCircle2 className="size-4" />
                  <span className="sr-only">{account.name} </span>Connected
                </span>
              ) : (
                <Button
                  onClick={() => void account.signIn()}
                  variant="outline"
                  disabled={account.loading || isConnecting}
                  aria-label={`Sign in with ${account.name}`}
                  className="shrink-0"
                >
                  {account.connecting || account.loading ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
                </Button>
              )}
            </div>
            {account.connecting && (
              <div role="status" className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <p>Complete sign in in your browser, then return here.</p>
                {account.id === "chatgpt" && (
                  <Button variant="ghost" size="sm" onClick={chatgpt.cancelSignIn}>Cancel</Button>
                )}
              </div>
            )}
          </div>
        ))}
        {canContinue && (
          <Button
            onClick={() => {
              state.setOnboardingPath(rowboatState.isConnected ? "rowboat" : "chatgpt")
              state.setCurrentStep(2)
            }}
            disabled={isConnecting}
            size="lg"
            className="w-full h-12 text-base font-medium"
          >
            Continue
          </Button>
        )}
      </motion.div>

      {/* BYOK link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-6"
      >
        <button
          onClick={() => {
            state.setOnboardingPath('byok')
            state.setCurrentStep(1)
          }}
          disabled={isConnecting}
          className="disabled:opacity-50 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-muted-foreground/30 hover:decoration-foreground/50"
        >
          I want to bring my own API key
        </button>
      </motion.div>
    </div>
  )
}
