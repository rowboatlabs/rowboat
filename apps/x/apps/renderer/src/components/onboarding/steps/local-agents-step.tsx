import { useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import type { spaces } from "@x/shared"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { AgentLogo } from "@/components/spaces/agent-setup"
import { EngineCard, useLocalAgents, useLocalEngine, type LocalEngine } from "@/components/spaces/local-agent"
import { refreshMembers, refreshOrgRoster, useSelfDisplayName } from "@/hooks/use-space-members"
import { getSpacesOrgs, refreshSpacesOrgs, useSpacesOrgs, type OrgWithSpaces } from "@/hooks/use-spaces"
import { kindInfo, personalAgentName } from "@/lib/agent-kinds"
import { toast } from "@/lib/toast"
import type { OnboardingState } from "../use-onboarding-state"

// The last onboarding step (2026-11-06): the person's own Claude Code and
// Codex join their space as local agents, run by this computer
// (components/spaces/local-agent.tsx). It replaced connecting email and
// calendar, which belong to Local. An engine that isn't installed yet
// downloads in the background; its agent answers once it is.

type Kind = spaces.SpacesLocalAgent["kind"]
const KINDS: Kind[] = ["claude-code", "codex"]

export function LocalAgentsStep({ state }: { state: OnboardingState }) {
  const { orgs } = useSpacesOrgs()
  // The space onboarding just made, or the first one already there.
  const org = orgs.find((o) => o.spaces.length > 0) ?? orgs[0]
  return org ? <AddAgents state={state} org={org} /> : <NoSpace state={state} />
}

function AddAgents({ state, org }: { state: OnboardingState; org: OrgWithSpaces }) {
  const { handleBack, handleComplete } = state
  const claude = useLocalEngine("claude-code")
  const codex = useLocalEngine("codex")
  const engines: Record<Kind, LocalEngine> = { "claude-code": claude, codex }
  const local = useLocalAgents()
  const ownName = useSelfDisplayName(org.id, org.memberId, org.spaces.map((s) => s.id)) ?? undefined
  // A returning person's agents are already here: nothing to add twice.
  const existing = new Set(local?.agents.filter((a) => a.orgId === org.id).map((a) => a.kind))
  const [selected, setSelected] = useState<Record<Kind, boolean>>({ "claude-code": true, codex: true })
  const [busy, setBusy] = useState(false)

  const finish = async () => {
    setBusy(true)
    try {
      const adding = KINDS.filter((k) => selected[k] && !existing.has(k))
      if (adding.length > 0) {
        await window.ipc.invoke("codeMode:setConfig", { enabled: true, approvalPolicy: "ask" }).catch(() => {})
        window.dispatchEvent(new Event("code-mode-config-changed"))
      }
      for (const kind of adding) {
        // Don't hold onboarding on a ~200 MB download; it continues in main.
        void engines[kind].install().catch(() => {})
        const label = kindInfo(kind).label
        try {
          const { agent } = await window.ipc.invoke("spaces:addLocalAgent", {
            orgId: org.id,
            displayName: personalAgentName(ownName, label),
            kind,
            cwd: local?.defaultCwd ?? "",
            policy: "yolo",
          })
          const latest = getSpacesOrgs().find((o) => o.id === org.id) ?? org
          await Promise.allSettled(latest.spaces.map((space) =>
            window.ipc.invoke("spaces:addMembers", { orgId: org.id, spaceId: space.id, memberIds: [agent.id] })
              .then(() => refreshMembers(org.id, space.id, { force: true }))))
        } catch (err) {
          toast(err instanceof Error ? err.message : `Couldn't add ${label}`, "error")
        }
      }
      refreshOrgRoster(org.id)
      await refreshSpacesOrgs()
    } finally {
      setBusy(false)
    }
    handleComplete()
  }

  return (
    <div className="flex flex-col flex-1">
      <h2 className="text-3xl font-bold tracking-tight text-center mb-2">
        Bring your coding agents
      </h2>
      <p className="text-base text-muted-foreground text-center leading-relaxed mb-5 max-w-md mx-auto">
        They join {org.name} as your agents, running on this computer with your own login.
      </p>

      <div className="space-y-3">
        {KINDS.map((kind) => {
          const info = kindInfo(kind)
          const added = existing.has(kind)
          return (
            <div key={kind} className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center gap-3">
                <AgentLogo logo={info.logo} className="size-6" />
                <div className="flex-1 min-w-0 text-sm font-medium">{info.label}</div>
                {added ? (
                  <span className="text-xs text-muted-foreground">Already in your space</span>
                ) : (
                  <Switch
                    aria-label={info.label}
                    disabled={busy}
                    checked={selected[kind]}
                    onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [kind]: v }))}
                  />
                )}
              </div>
              {(added || selected[kind]) && <EngineCard engine={engines[kind]} />}
            </div>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 mt-6 pt-4 border-t">
        <Button onClick={() => void finish()} size="lg" className="h-12 text-base font-medium" disabled={busy}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : "Start using Rowboat"}
        </Button>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={handleBack} disabled={busy} className="gap-1">
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <Button variant="ghost" onClick={handleComplete} disabled={busy} className="text-muted-foreground">
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Signed in without a Rowboat account, there is no space for agents to join yet. */
function NoSpace({ state }: { state: OnboardingState }) {
  const { handleBack, handleComplete } = state
  return (
    <div className="flex flex-col flex-1 items-center justify-center text-center">
      <h2 className="text-3xl font-bold tracking-tight mb-2">Bring your coding agents</h2>
      <p className="text-base text-muted-foreground leading-relaxed mb-6 max-w-md">
        Claude Code and Codex join a space as your agents. Create or join a space in Spaces, then add them from its Agents page.
      </p>
      <Button onClick={handleComplete} size="lg" className="w-full h-12 text-base font-medium">Start using Rowboat</Button>
      <Button variant="ghost" onClick={handleBack} className="mt-4 gap-1 text-muted-foreground">
        <ArrowLeft className="size-4" />
        Back
      </Button>
    </div>
  )
}
