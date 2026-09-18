import { useState, useEffect, useCallback } from "react"
import { Loader2, ArrowLeft, Terminal, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { type CodeModeAgentStatus } from "@/lib/code-mode-provisioning"
import { KNOWN_AGENTS, agentLabel } from "@x/shared/src/agent-catalog.js"
import type { CodingAgent } from "@x/shared/src/code-mode.js"
import type { OnboardingState } from "../use-onboarding-state"

interface CodeModeStepProps {
  state: OnboardingState
}

const AGENTS = KNOWN_AGENTS.map((key) => ({ key, name: agentLabel(key) }))

export function CodeModeStep({ state }: CodeModeStepProps) {
  const { handleNext, handleBack } = state

  const [enabled, setEnabled] = useState(false)
  const [selected, setSelected] = useState<Record<CodingAgent, boolean>>({ opencode: false, cursor: false, hermes: false })
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
        const installed = Object.fromEntries(
          KNOWN_AGENTS.map((agent) => [agent, result[agent]?.installed ?? false]),
        ) as Record<CodingAgent, boolean>
        if (Object.values(installed).some(Boolean)) {
          setEnabled(true)
          setSelected(installed)
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
        Use OpenCode, Cursor, or Hermes in Rowboat. Install the CLI you want and put it on your PATH —
        Rowboat detects it automatically.
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
              <span className="text-[13px] text-muted-foreground">
                Agents to set up
              </span>
              {AGENTS.map((a) => {
                const st = status?.[a.key]
                const ready = st?.installed ?? false
                return (
                  <div key={a.key} className="rounded-xl border px-4 py-3 flex items-center gap-3">
                    <Terminal className="size-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0 text-sm font-medium">{a.name}</div>
                    {ready && <CheckCircle2 className="size-4 text-[var(--rowboat-success)] shrink-0" />}
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
