import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { applyProfileUpdate } from '@/hooks/use-space-members'
import { LOCAL_RUNTIME } from '@/lib/feature-flags'
import { toast } from '@/lib/toast'

// An agent's description and personality (Harbor spec §4 Agent members,
// 2026-10-29). Both optional, both set by its owner, both readable by every
// org member. The description is one line wherever it is listed; the
// personality is what the agent reads before every request (Claude Code on
// this computer gets it as its system prompt). Describe → Write has a light
// Rowboat model draft the personality from a few words, for the owner to edit.
// Desktop only: the web app runs no models of its own.

export const INSTRUCTIONS_MAX = 4000
const DESCRIPTION_MAX = 128

export function PersonalityFields({ name, kind, title, onTitle, instructions, onInstructions, disabled = false }: {
    /** The agent's name and kind, so a written personality knows who it is for. */
    name: string
    kind?: string
    title: string
    onTitle: (title: string) => void
    instructions: string
    onInstructions: (instructions: string) => void
    disabled?: boolean
}) {
    const [brief, setBrief] = useState('')
    const [writing, setWriting] = useState(false)

    const write = async () => {
        if (writing || !brief.trim()) return
        setWriting(true)
        try {
            const { instructions: written } = await window.ipc.invoke('spaces:writeAgentInstructions', { name, ...(kind ? { kind } : {}), brief: brief.trim() })
            onInstructions(written)
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Couldn’t write the personality', 'error')
        } finally {
            setWriting(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">
                    Description <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <Input
                    value={title}
                    onChange={(e) => onTitle(e.target.value)}
                    placeholder="e.g. Reviews pull requests and runs the tests"
                    aria-label="Description"
                    className="h-9 text-sm"
                    maxLength={DESCRIPTION_MAX}
                    disabled={disabled}
                />
                <span className="text-[11px] text-muted-foreground">One line, shown on its card and profile.</span>
            </label>
            <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-foreground">
                    Personality <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                {LOCAL_RUNTIME && (
                    // Not a form: these fields sit inside the Add form, and forms don't nest. Enter writes.
                    <div className="flex items-center gap-2">
                        <Input
                            value={brief}
                            onChange={(e) => setBrief(e.target.value)}
                            placeholder="Describe it, e.g. a terse reviewer that always runs the tests"
                            aria-label="Describe its personality"
                            className="h-8 min-w-0 flex-1 text-xs"
                            maxLength={1000}
                            disabled={disabled || writing}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter') return
                                e.preventDefault()
                                void write()
                            }}
                        />
                        <Button type="button" size="sm" variant="outline" disabled={disabled || writing || !brief.trim()} onClick={() => void write()}>
                            {writing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                            {instructions.trim() ? 'Rewrite' : 'Write'}
                        </Button>
                    </div>
                )}
                <Textarea
                    value={instructions}
                    onChange={(e) => onInstructions(e.target.value)}
                    placeholder={'How it should behave. It reads this before every request.\nYou are Scout, the team’s reviewer. Be brief…'}
                    aria-label="Personality"
                    className="min-h-28 text-xs leading-relaxed"
                    maxLength={INSTRUCTIONS_MAX}
                    disabled={disabled || writing}
                />
                <span className="flex justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>Everyone in the server can read it.</span>
                    {instructions.length > INSTRUCTIONS_MAX - 500 && <span className="tabular-nums">{instructions.length} / {INSTRUCTIONS_MAX}</span>}
                </span>
            </div>
        </div>
    )
}

/** Save a new agent's description and personality, when the form had any. A failure doesn't undo the agent. */
export async function saveAgentProfile(orgId: string, agentId: string, profile: { title: string; instructions: string }): Promise<void> {
    const title = profile.title.trim()
    const instructions = profile.instructions.trim()
    if (!title && !instructions) return
    try {
        const { agent } = await window.ipc.invoke('spaces:setAgentProfile', { orgId, agentId, ...(title ? { title } : {}), ...(instructions ? { instructions } : {}) })
        applyProfileUpdate(orgId, agent)
    } catch (err) {
        toast(err instanceof Error ? `Added, but its personality wasn’t saved: ${err.message}` : 'Added, but its personality wasn’t saved', 'error')
    }
}

/** On the agent's page: its owner edits both and saves; everyone else reads them. */
export function PersonalitySection({ orgId, agent, canEdit, onSaved }: { orgId: string; agent: spaces.Member; canEdit: boolean; onSaved?: () => Promise<void> }) {
    const [title, setTitle] = useState(agent.title ?? '')
    const [instructions, setInstructions] = useState(agent.instructions ?? '')
    const [busy, setBusy] = useState(false)
    const dirty = title.trim() !== (agent.title ?? '') || instructions.trim() !== (agent.instructions ?? '')

    if (!canEdit) {
        return (
            <section aria-label="Description and personality" className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground">Description and personality</h3>
                {agent.title ? <p className="text-xs text-foreground">{agent.title}</p> : <p className="text-xs text-muted-foreground">No description.</p>}
                {agent.instructions ? (
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-sans text-xs leading-relaxed text-foreground">{agent.instructions}</pre>
                ) : (
                    <p className="text-xs text-muted-foreground">No personality set.</p>
                )}
            </section>
        )
    }

    const save = async () => {
        if (busy || !dirty) return
        setBusy(true)
        try {
            const { agent: updated } = await window.ipc.invoke('spaces:setAgentProfile', { orgId, agentId: agent.id, title, instructions })
            applyProfileUpdate(orgId, updated)
            setTitle(updated.title ?? '')
            setInstructions(updated.instructions ?? '')
            toast('Saved. It applies from the next mention.', 'success', 2000)
            await onSaved?.()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Couldn’t save', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <section aria-label="Description and personality" className="flex flex-col gap-3">
            <div>
                <h3 className="text-sm font-semibold text-foreground">Description and personality</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">It reads its personality before every request. Changes apply from the next mention.</p>
            </div>
            <PersonalityFields name={agent.displayName} {...(agent.agentKind ? { kind: agent.agentKind } : {})} title={title} onTitle={setTitle} instructions={instructions} onInstructions={setInstructions} disabled={busy} />
            <div className="flex justify-end gap-2">
                {dirty && (
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                            setTitle(agent.title ?? '')
                            setInstructions(agent.instructions ?? '')
                        }}
                    >
                        Discard
                    </Button>
                )}
                <Button size="sm" aria-label="Save description and personality" disabled={busy || !dirty} onClick={() => void save()}>
                    {busy && <Loader2 className="size-3.5 animate-spin" />} Save
                </Button>
            </div>
        </section>
    )
}
