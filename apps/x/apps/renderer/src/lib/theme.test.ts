import { afterEach, describe, expect, it, vi } from 'vitest'

import { readStoredTheme, resolveTheme, THEME_STORAGE_KEY } from './theme'

function stubSystem(prefersDark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark') ? prefersDark : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('readStoredTheme', () => {
  it('reads the key the ThemeProvider writes', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readStoredTheme()).toBe('dark')
  })

  it('falls back when nothing is stored', () => {
    expect(readStoredTheme()).toBe('system')
    expect(readStoredTheme('light')).toBe('light')
  })

  // A window that trusted whatever was in storage would paint an unstyled
  // card: the companion has no provider to correct it afterwards.
  it('falls back when the stored value is junk', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized')
    expect(readStoredTheme()).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('passes explicit choices through, whatever the OS says', () => {
    stubSystem(true)
    expect(resolveTheme('light')).toBe('light')
    stubSystem(false)
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('resolves "system" against this window\'s matchMedia', () => {
    stubSystem(true)
    expect(resolveTheme('system')).toBe('dark')
    stubSystem(false)
    expect(resolveTheme('system')).toBe('light')
  })
})
