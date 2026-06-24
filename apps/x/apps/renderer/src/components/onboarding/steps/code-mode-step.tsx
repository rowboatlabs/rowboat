import { useState, useEffect, useCallback } from "react"
import { Loader2, ArrowLeft, Terminal, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { startProvisioning, type CodeModeAgentStatus } from "@/lib/code-mode-provisioning"
import type { OnboardingState } from "../use-onboarding-state"

interface CodeModeStepProps {
  state: OnboardingState
}

const AGENTS = [
  { key: "claude" as const, name: "Claude Code" },
  { key: "codex" as const, name: "Codex" },
]

export function CodeModeStep({ state }: CodeModeStepProps) {
  const { handleNext, handleBack } = state

  const [enabled, setEnabled] = useState(false)
  const [selected, setSelected] = useState<Record<"claude" | "codex", boolean>>({ claude: false, codex: false })
  const [status, setStatus] = useState<CodeModeAgentStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Reflect what's already set up: pre-select installed agents and turn the master
  // switch on if any agent is already there, so returning users don't start from off.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setStatusLoading(true)
      try {
        const result = await window.ipc.invoke("codeMode:checkAgentStatus", null)
        if (cancelled) return
        setStatus(result)
        const claudeInstalled = result.claude.installed
        const codexInstalled = result.codex.installed
        if (claudeInstalled || codexInstalled) {
          setEnabled(true)
          setSelected({ claude: claudeInstalled, codex: codexInstalled })
        }
      } catch {
        if (!cancelled) setStatus(null)
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const onContinue = useCallback(async () => {
    if (enabled) {
      setSaving(true)
      try {
        await window.ipc.invoke("codeMode:setConfig", { enabled: true, approvalPolicy: "ask" })
        window.dispatchEvent(new Event("code-mode-config-changed"))
      } catch {
        // Non-fatal — the user can still enable code mode later from Settings.
      }
      setSaving(false)
      // Kick off engine downloads in the BACKGROUND for selected agents that aren't
      // installed yet. We deliberately don't block onboarding on the ~200 MB download —
      // it keeps running in the main process and its progress shows in Settings → Code Mode.
      for (const a of AGENTS) {
        if (selected[a.key] && !status?.[a.key].installed) {
          startProvisioning(a.key, () => {})
        }
      }
    }
    handleNext()
  }, [enabled, selected, status, handleNext])

  return (
    <div className="flex flex-col flex-1">
      {/* Title */}
      <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
        Set Up Code Mode
      </h2>
      <p className="text-base text-muted-foreground text-center leading-relaxed mb-6 max-w-md mx-auto">
        Use your existing Claude Code or Codex subscription inside Rowboat to tackle coding
        tasks and unlock far more workflows, all without leaving the app. Make sure Claude Code
        and Codex are signed in locally with{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground">claude&nbsp;login</code> or{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground">codex&nbsp;login</code> in your terminal.
      </p>

      {statusLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Master enable */}
          <div className="rounded-xl border px-4 py-3.5 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Enable code mode</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Shows the code mode chip in the composer and lets the assistant delegate to your agents.
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={saving} />
          </div>

          {/* Per-agent selection (revealed when enabled) */}
          {enabled && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Agents to set up
              </span>
              {AGENTS.map((a) => {
                const st = status?.[a.key]
                const ready = (st?.installed ?? false) && (st?.signedIn ?? false)
                return (
                  <div key={a.key} className="rounded-xl border px-4 py-3 flex items-center gap-3">
                    <Terminal className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0 text-sm font-medium">{a.name}</div>
                    {ready && <CheckCircle2 className="size-4 text-green-600 shrink-0" />}
                    <Switch
                      checked={selected[a.key]}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [a.key]: v }))}
                    />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex flex-col gap-3 mt-8 pt-4 border-t">
        <Button onClick={onContinue} size="lg" className="h-12 text-base font-medium" disabled={saving}>
          {saving ? <Loader2 className="size-5 animate-spin" /> : "Continue"}
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
