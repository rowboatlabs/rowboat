import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '@/contexts/theme-context'

// xterm color schemes tuned to the app's light/dark backgrounds.
const DARK_THEME = {
  background: '#000000',
  foreground: '#d4d4d8',
  cursor: '#d4d4d8',
  selectionBackground: 'rgba(120, 140, 255, 0.3)',
}
const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#27272a',
  cursor: '#27272a',
  selectionBackground: 'rgba(60, 90, 220, 0.2)',
}

// One embedded terminal view, attached to a per-session PTY in the main
// process. The PTY outlives this component (collapse/switch just detaches);
// on mount we re-attach and repaint from the backlog the main process keeps.
export function TerminalPane({ terminalId, cwd }: { terminalId: string; cwd: string }) {
  const { resolvedTheme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)

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

    let disposed = false

    // Attach (or spawn) the PTY at the current size, then repaint history.
    void window.ipc.invoke('terminal:ensure', {
      id: terminalId,
      cwd,
      cols: term.cols,
      rows: term.rows,
    }).then(({ backlog }) => {
      if (disposed) return
      if (backlog) term.write(backlog)
      term.focus()
    })

    const dataDisposable = term.onData((data) => {
      void window.ipc.invoke('terminal:input', { id: terminalId, data })
    })

    const offData = window.ipc.on('terminal:data', (payload) => {
      if (payload.id === terminalId) term.write(payload.data)
    })
    const offExit = window.ipc.on('terminal:exit', (payload) => {
      if (payload.id !== terminalId) return
      term.write(`\r\n\x1b[2m[process exited with code ${payload.exitCode} — press Enter to restart]\x1b[0m\r\n`)
    })

    // Restart the shell on Enter after it exited (ensure() respawns dead PTYs).
    const keyDisposable = term.onKey(({ domEvent }) => {
      if (domEvent.key !== 'Enter') return
      void window.ipc.invoke('terminal:ensure', {
        id: terminalId,
        cwd,
        cols: term.cols,
        rows: term.rows,
      })
    })

    const resizeObserver = new ResizeObserver(() => {
      if (container.clientHeight === 0) return
      fit.fit()
      void window.ipc.invoke('terminal:resize', { id: terminalId, cols: term.cols, rows: term.rows })
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      offData()
      offExit()
      dataDisposable.dispose()
      keyDisposable.dispose()
      term.dispose()
      termRef.current = null
    }
    // The PTY is keyed by terminalId; cwd changes (worktree cleanup) respawn via ensure.
  }, [terminalId, cwd])

  // Live theme switches restyle the existing terminal without a respawn.
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
  }, [resolvedTheme])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden px-2 pt-1"
      style={{ backgroundColor: resolvedTheme === 'dark' ? '#000000' : '#ffffff' }}
    />
  )
}
