import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './theme-context'

function Preferences() {
  const { assistantPresentation, setAssistantPresentation, chatPanePlacement, chatPaneSize } = useTheme()
  return <>
    <output aria-label="presentation">{assistantPresentation}</output>
    <output aria-label="sidebar preferences">{chatPanePlacement} / {chatPaneSize}</output>
    <button onClick={() => setAssistantPresentation('bottom-tabs')}>Use bottom tabs</button>
    <button onClick={() => setAssistantPresentation('sidebar')}>Use sidebar</button>
  </>
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('assistant presentation preference', () => {
  it('defaults to sidebar and ignores invalid saved modes', () => {
    localStorage.setItem('rowboat-assistant-presentation', 'unsupported')
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(screen.getByLabelText('presentation')).toHaveTextContent('sidebar')
  })

  it('persists the opt-in mode without changing sidebar placement or size', () => {
    localStorage.setItem('rowboat-chat-pane-placement', 'middle')
    localStorage.setItem('rowboat-chat-pane-size', 'chat-equal')
    const { unmount } = render(<ThemeProvider><Preferences /></ThemeProvider>)
    fireEvent.click(screen.getByText('Use bottom tabs'))
    expect(screen.getByLabelText('presentation')).toHaveTextContent('bottom-tabs')
    unmount()
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(screen.getByLabelText('presentation')).toHaveTextContent('bottom-tabs')
    fireEvent.click(screen.getByText('Use sidebar'))
    expect(screen.getByLabelText('sidebar preferences')).toHaveTextContent('middle / chat-equal')
    expect(localStorage.getItem('rowboat-assistant-presentation')).toBe('sidebar')
  })
})
