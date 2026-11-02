import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CodexSignIn } from './codex-sign-in'

// Creation waits for the VM before adopting credentials or sharing the agent (2026-11-02).
export function CodexCreateAccess({ orgId, agentId, mode, apiKey, onComplete }: {
    orgId: string
    agentId: string
    mode: 'chatgpt' | 'key'
    apiKey: string
    onComplete: () => Promise<void>
}) {
    const [ready, setReady] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [retry, setRetry] = useState(0)
    const complete = useRef(onComplete)
    complete.current = onComplete
    useEffect(() => {
        let stopped = false
        let timer: ReturnType<typeof setTimeout>
        const poll = async () => {
            try {
                const { agents } = await window.ipc.invoke('spaces:listAgents', { orgId })
                if (stopped) return
                const hosting = agents.find(item => item.agent.id === agentId)?.hosting
                if (!hosting || ['error', 'failed', 'deleted', 'deleting'].includes(hosting.status)) throw new Error(hosting?.error || 'Could not prepare the agent. Check its status before retrying.')
                if (hosting.status !== 'ready') {
                    timer = setTimeout(poll, 1500)
                    return
                }
                if (mode === 'key') {
                    await window.ipc.invoke('spaces:setHostingLlm', { orgId, agentId, provider: 'openai', apiKey: apiKey.trim() })
                    if (!stopped) await complete.current()
                } else setReady(true)
            } catch (err) {
                if (!stopped) setError(err instanceof Error ? err.message : 'Could not prepare model access')
            }
        }
        void poll()
        return () => { stopped = true; clearTimeout(timer) }
    }, [orgId, agentId, mode, apiKey, retry])
    return <div className="flex flex-col gap-3">
        {!ready && !error && <p role="status" className="text-sm text-muted-foreground">{mode === 'key' ? 'Preparing the agent and connecting your OpenAI key…' : 'Preparing the agent for ChatGPT sign-in…'}</p>}
        {error && <><p role="alert" className="text-sm text-destructive">{error}</p><Button onClick={() => { setError(null); setRetry(value => value + 1) }}>Retry setup</Button></>}
        {ready && <CodexSignIn orgId={orgId} agentId={agentId} connected={false} disabled={false} onChanged={() => complete.current()} />}
        <p className="text-xs text-muted-foreground">Your agent has been created. Closing this dialog keeps it in your agents list.</p>
    </div>
}
