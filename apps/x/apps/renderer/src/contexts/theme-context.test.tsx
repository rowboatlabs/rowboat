import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './theme-context'

function Preferences() {
  const { chatPanePlacement, chatPaneSize } = useTheme()
  return <output aria-label="sidebar preferences">{chatPanePlacement} / {chatPaneSize}</output>
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('workspace chat pane preferences', () => {
  it('defaults to a smaller chat on the right', () => {
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(screen.getByLabelText('sidebar preferences')).toHaveTextContent('right / chat-smaller')
  })

  it('restores saved placement and size', () => {
    localStorage.setItem('rowboat-chat-pane-placement', 'middle')
    localStorage.setItem('rowboat-chat-pane-size', 'chat-equal')
    render(<ThemeProvider><Preferences /></ThemeProvider>)
    expect(screen.getByLabelText('sidebar preferences')).toHaveTextContent('middle / chat-equal')
  })
})
