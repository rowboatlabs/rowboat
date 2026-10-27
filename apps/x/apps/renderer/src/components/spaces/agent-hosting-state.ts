import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { spaces } from '@x/shared'
import { toast } from '@/lib/toast'

// What the agent page knows about a managed agent's VM (2026-10-27), shared
// by the tabs that show it and the Danger zone that deletes from it. The
// machine and the variables are read when the page opens; skills and
// automations when a tab first asks. See agent-hosting.tsx for the screens.

/** Where each kind keeps its things on the volume: the files browser opens here. */
export const HOME: Record<string, string> = { hermes: '/opt/data', codex: '/data', 'claude-code': '/data' }

export function fail(err: unknown, fallback: string) {
    toast(err instanceof Error ? err.message : fallback, 'error')
}

/** What the page knows about the VM, shared by the tabs that show it and the Danger zone that deletes from it. */
export type HostingState = {
    machine: spaces.HostingMachine | undefined
    setMachine: (m: spaces.HostingMachine) => void
    env: spaces.HostingEnvVar[] | null
    setEnv: (env: spaces.HostingEnvVar[]) => void
    /** On a trial: what the agent has drawn on Rowboat's credit, as the platform counts it. */
    spend: spaces.HostingSpend | undefined
    setSpend: (spend: spaces.HostingSpend | undefined) => void
    skills: spaces.HostingSkill[] | null
    setSkills: (skills: spaces.HostingSkill[]) => void
    loadSkills: () => Promise<void>
    triggers: spaces.HostingTrigger[] | null
    setTriggers: (triggers: spaces.HostingTrigger[]) => void
    loadTriggers: () => Promise<void>
    /** Bumped when the Danger zone deletes a path, so the Files tab lists again. */
    filesEpoch: number
    bumpFiles: () => void
}

export function useHostingState(orgId: string, agentId: string, live: boolean): HostingState {
    const [machine, setMachine] = useState<spaces.HostingMachine | undefined>(undefined)
    const [env, setEnv] = useState<spaces.HostingEnvVar[] | null>(null)
    const [spend, setSpend] = useState<spaces.HostingSpend | undefined>(undefined)
    const [skills, setSkills] = useState<spaces.HostingSkill[] | null>(null)
    const [triggers, setTriggers] = useState<spaces.HostingTrigger[] | null>(null)
    const [filesEpoch, setFilesEpoch] = useState(0)
    const inFlight = useRef(new Set<string>())

    useEffect(() => {
        if (!live) return
        let gone = false
        window.ipc
            .invoke('spaces:getHosting', { orgId, agentId })
            .then((page) => {
                if (gone) return
                setMachine(page.machine)
                setEnv(page.env)
                setSpend(page.spend)
            })
            .catch((err: unknown) => {
                if (gone) return
                fail(err, 'Could not read the hosting')
                setEnv([])
            })
        return () => {
            gone = true
        }
    }, [orgId, agentId, live])

    const loadSkills = useCallback(async () => {
        if (inFlight.current.has('skills')) return
        inFlight.current.add('skills')
        try {
            setSkills((await window.ipc.invoke('spaces:listHostingSkills', { orgId, agentId })).skills)
        } catch (err) {
            fail(err, 'Could not list the skills')
            setSkills([])
        } finally {
            inFlight.current.delete('skills')
        }
    }, [orgId, agentId])

    const loadTriggers = useCallback(async () => {
        if (inFlight.current.has('triggers')) return
        inFlight.current.add('triggers')
        try {
            setTriggers((await window.ipc.invoke('spaces:listHostingTriggers', { orgId, agentId })).triggers)
        } catch (err) {
            fail(err, 'Could not list the triggers')
            setTriggers([])
        } finally {
            inFlight.current.delete('triggers')
        }
    }, [orgId, agentId])

    return useMemo(
        () => ({ machine, setMachine, env, setEnv, spend, setSpend, skills, setSkills, loadSkills, triggers, setTriggers, loadTriggers, filesEpoch, bumpFiles: () => setFilesEpoch((e) => e + 1) }),
        [machine, env, spend, skills, loadSkills, triggers, loadTriggers, filesEpoch],
    )
}
