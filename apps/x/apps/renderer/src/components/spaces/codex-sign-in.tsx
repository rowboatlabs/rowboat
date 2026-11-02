import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'

// Device login runs on the VM (spec §8 Maritime, 2026-11-02). Only Harbor's
// login-status check may switch funding; a browser redirect proves nothing.
export function CodexSignIn({ orgId, agentId, connected, disabled, onChanged }: {
    orgId: string
    agentId: string
    connected: boolean
    disabled: boolean
    onChanged: () => Promise<void>
}) {
    const [attempt, setAttempt] = useState<{ execution: spaces.HostingExecution; outputPath: string } | null>(null)
    const [instructions, setInstructions] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [retry, setRetry] = useState(0)
    const generation = useRef(0)
    const changed = useRef(onChanged)
    changed.current = onChanged
    const executionId = attempt?.execution.id
    const outputPath = attempt?.outputPath
    const running = attempt?.execution.status === 'running'
    const output = instructions.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim()
    const url = output.match(/https:\/\/auth\.openai\.com\/codex\/device\b/)?.[0]

    const verify = async () => {
        const result = await window.ipc.invoke('spaces:checkHostingSignIn', { orgId, agentId })
        if (!result.signedIn) throw new Error('Complete ChatGPT sign-in before connecting.')
    }

    const act = async (action: 'start' | 'connect' | 'disconnect') => {
        if (busy) return
        const current = ++generation.current
        setBusy(true)
        setError(null)
        try {
            if (action === 'start') {
                const next = await window.ipc.invoke('spaces:startHostingSignIn', { orgId, agentId })
                if (current !== generation.current) return
                setInstructions('')
                setAttempt({ ...next, execution: { ...next.execution, status: 'running' } })
            } else {
                if (action === 'connect') await verify()
                else await window.ipc.invoke('spaces:revokeHostingSignIn', { orgId, agentId })
                if (current !== generation.current) return
                setAttempt(null)
                setInstructions('')
                await changed.current()
            }
        } catch (err) {
            if (current === generation.current) setError(err instanceof Error ? err.message : 'Could not update ChatGPT sign-in. Try again.')
        } finally {
            if (current === generation.current) setBusy(false)
        }
    }

    useEffect(() => {
        if (!executionId || !outputPath || !running) return
        let stopped = false
        let timer: ReturnType<typeof setTimeout>
        const current = generation.current
        const stale = () => stopped || current !== generation.current
        const poll = async () => {
            try {
                const [{ execution }, file] = await Promise.all([
                    window.ipc.invoke('spaces:getHostingCommand', { orgId, agentId, executionId }),
                    window.ipc.invoke('spaces:readHostingFile', { orgId, agentId, path: outputPath }),
                ])
                if (stale()) return
                setInstructions(file.content || execution.stdout || execution.stderr || '')
                if (execution.status === 'running') {
                    timer = setTimeout(poll, 1500)
                } else if (execution.status === 'completed' && execution.exitCode === 0) {
                    const result = await window.ipc.invoke('spaces:checkHostingSignIn', { orgId, agentId })
                    if (stale()) return
                    if (!result.signedIn) throw new Error('Complete ChatGPT sign-in before connecting.')
                    setAttempt(null)
                    setInstructions('')
                    await changed.current()
                } else {
                    setAttempt({ execution, outputPath })
                    setError('Sign-in did not complete. Try again, and check that device-code login is enabled in your ChatGPT security settings. Another sign-in may already be running.')
                }
            } catch (err) {
                if (!stale()) setError(err instanceof Error ? err.message : 'Could not check sign-in. Try checking again.')
            }
        }
        timer = setTimeout(poll, 1500)
        return () => { stopped = true; clearTimeout(timer) }
    }, [running, executionId, outputPath, orgId, agentId, retry])

    // Leaving the page stops UI updates, not the bounded VM login; Finish connecting
    // can adopt a login completed while this page was closed (2026-11-02).
    useEffect(() => () => { generation.current++ }, [])

    const cancel = async () => {
        if (!executionId || busy) return
        ++generation.current
        setBusy(true)
        try {
            await window.ipc.invoke('spaces:cancelHostingCommand', { orgId, agentId, executionId })
            setAttempt(null)
            setInstructions('')
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not cancel sign-in.')
        } finally { setBusy(false) }
    }

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3" aria-label="ChatGPT sign-in">
            <div>
                <p className="text-sm font-medium">{connected ? 'ChatGPT account connected' : 'Use your ChatGPT account'}</p>
                <p className="mt-1 text-xs text-muted-foreground">Sign in to Codex on this agent’s hosted machine. Anyone allowed to use this agent will use your account’s limits. Workspace administrators can manage the machine.</p>
                {!connected && <p className="mt-1 text-xs text-muted-foreground">Connecting ends the Rowboat trial. Your account must support Codex and allow device-code login.</p>}
            </div>
            {output && <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{output}</pre>}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
                {running ? (
                    <>
                        {url && <Button size="sm" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>Continue in browser <ExternalLink className="size-3.5" /></Button>}
                        {!error && <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Waiting for sign-in…</span>}
                        <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => void cancel()}>Cancel sign-in</Button>
                        {error && <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => { setError(null); setRetry(value => value + 1) }}>Check again</Button>}
                    </>
                ) : connected ? (
                    <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void act('disconnect')}>Disconnect ChatGPT</Button>
                ) : (
                    <>
                        <Button size="sm" disabled={disabled || busy} onClick={() => void act('start')}>{busy && <Loader2 className="size-3.5 animate-spin" />} Sign in with ChatGPT</Button>
                        <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={() => void act('connect')}>Finish connecting</Button>
                    </>
                )}
            </div>
            {connected && <p className="text-xs text-muted-foreground">Disconnecting signs Codex out on this machine. It does not restore trial credit.</p>}
        </div>
    )
}
