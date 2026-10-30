import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RefreshCw } from 'lucide-react'
import type { spaces } from '@x/shared'
import { Button } from '@/components/ui/button'
import { fail } from '@/components/spaces/agent-hosting-state'
import { ScreenHeader, Tag } from '@/components/spaces/agent-tabs'
import { useTheme } from '@/contexts/theme-context'

// The VM's shell, live (2026-10-30). Harbor mints a short-lived console token for
// the agent's own end user on Maritime, and the browser opens Maritime's terminal
// socket with it: the same socket the Maritime dashboard's Console tab uses.
// Output arrives as binary frames; control is JSON text (`resize` up, `ping`
// down answered with `pong`). Keystrokes go down as the bytes themselves.
// Nothing of the session passes through Harbor, so the org's edge never sees
// what is typed, and a dropped socket is reopened with a new token.

type Link = 'connecting' | 'connected' | 'disconnected'

const DARK_THEME = { background: '#000000', foreground: '#d4d4d8', cursor: '#d4d4d8', selectionBackground: 'rgba(120, 140, 255, 0.3)' }
const LIGHT_THEME = { background: '#ffffff', foreground: '#27272a', cursor: '#27272a', selectionBackground: 'rgba(60, 90, 220, 0.2)' }

const encoder = new TextEncoder()

function sendResize(ws: WebSocket | null, term: Terminal) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
}

/** A JSON control message from the platform, or nothing when the frame is not one. */
function control(text: string): { type?: string; data?: string } | null {
    if (!text.startsWith('{')) return null
    try {
        const parsed: unknown = JSON.parse(text)
        return parsed && typeof parsed === 'object' ? (parsed as { type?: string; data?: string }) : null
    } catch {
        return null
    }
}

export function TerminalScreen({ orgId, agentId, agentName }: { orgId: string; agentId: string; agentName: string }) {
    const { resolvedTheme } = useTheme()
    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<Terminal | null>(null)
    const fitRef = useRef<FitAddon | null>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const [link, setLink] = useState<Link>('connecting')
    const [session, setSession] = useState(0)

    // The terminal lives as long as the screen; sessions come and go beneath it.
    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const term = new Terminal({
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            cursorBlink: true,
            scrollback: 5000,
            theme: resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME,
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(container)
        fit.fit()
        termRef.current = term
        fitRef.current = fit
        const input = term.onData((data) => {
            const ws = wsRef.current
            if (ws && ws.readyState === WebSocket.OPEN) ws.send(encoder.encode(data))
        })
        // Hidden tabs keep their panel mounted at no height: nothing to fit until it shows again.
        const observer =
            typeof ResizeObserver === 'undefined'
                ? null
                : new ResizeObserver(() => {
                      if (container.clientHeight === 0) return
                      fit.fit()
                      sendResize(wsRef.current, term)
                  })
        observer?.observe(container)
        return () => {
            observer?.disconnect()
            input.dispose()
            term.dispose()
            termRef.current = null
            fitRef.current = null
        }
        // The theme is applied live below; it must not rebuild the terminal.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        const term = termRef.current
        if (term) term.options.theme = resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
    }, [resolvedTheme])

    // One session per token: Harbor mints it, the browser opens the platform's socket with it.
    useEffect(() => {
        const term = termRef.current
        if (!term) return
        let ws: WebSocket | null = null
        let gone = false
        setLink('connecting')
        void (async () => {
            let opened: spaces.HostingConsole
            try {
                opened = (await window.ipc.invoke('spaces:openHostingConsole', { orgId, agentId })).console
            } catch (err) {
                if (gone) return
                fail(err, 'Could not open a console')
                setLink('disconnected')
                return
            }
            if (gone) return
            ws = new WebSocket(`${opened.url}?token=${encodeURIComponent(opened.token)}`)
            ws.binaryType = 'arraybuffer'
            wsRef.current = ws
            ws.onopen = () => {
                if (gone) return
                setLink('connected')
                fitRef.current?.fit()
                sendResize(ws, term)
                term.focus()
            }
            ws.onmessage = (event: MessageEvent<unknown>) => {
                if (gone) return
                if (typeof event.data !== 'string') {
                    // Binary frames are the shell's bytes (the socket is in arraybuffer mode).
                    if (event.data && typeof event.data === 'object') term.write(new Uint8Array(event.data as ArrayBuffer))
                    return
                }
                const message = control(event.data)
                if (!message) {
                    term.write(event.data)
                    return
                }
                if (message.type === 'ping') ws?.send(JSON.stringify({ type: 'pong' }))
                else if (typeof message.data === 'string') term.write(message.data)
            }
            ws.onclose = (event: CloseEvent) => {
                if (gone) return
                wsRef.current = null
                setLink('disconnected')
                term.write(`\r\n\x1b[2m[disconnected${event.reason ? `: ${event.reason}` : ''}]\x1b[0m\r\n`)
            }
        })()
        return () => {
            gone = true
            wsRef.current = null
            if (ws) {
                ws.onclose = null
                ws.close()
            }
        }
    }, [orgId, agentId, session])

    const status = link === 'connecting' ? 'Opening a console…' : link === 'connected' ? 'Connected. Leaving the page ends the session.' : 'Disconnected.'
    return (
        <>
            <ScreenHeader title="Terminal" note={`A live shell on ${agentName}'s VM, as root, over Maritime's own terminal socket. Interactive logins such as codex login --device-auth work here.`} />
            <div className="flex items-center gap-2">
                <Tag tone={link === 'connected' ? 'accent' : link === 'connecting' ? 'muted' : 'warn'}>{link}</Tag>
                <p role="status" className="text-[11px] text-muted-foreground">
                    {status}
                </p>
                {link === 'disconnected' && (
                    <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setSession((s) => s + 1)}>
                        <RefreshCw className="size-3" /> Reconnect
                    </Button>
                )}
            </div>
            <div
                ref={containerRef}
                role="application"
                aria-label="Terminal"
                className="h-80 min-h-0 overflow-hidden rounded-lg border border-border p-1.5 [&_.xterm]:h-full"
                style={{ background: resolvedTheme === 'dark' ? DARK_THEME.background : LIGHT_THEME.background }}
            />
        </>
    )
}
