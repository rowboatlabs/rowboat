import { describe, expect, it } from 'vitest'
import { closeTabs } from './close-tabs'

describe('closing tab groups', () => {
  const tabs = ['a', 'b', 'c', 'd']
  const id = (tab: string) => tab
  it('preserves an active survivor when closing tabs on both sides', () => {
    expect(closeTabs(tabs, 'b', ['a', 'c'], id)).toEqual({ tabs: ['b', 'd'], activeId: 'b' })
  })
  it('chooses the next surviving neighbor when the active tab closes', () => {
    expect(closeTabs(tabs, 'b', ['b', 'c'], id)).toEqual({ tabs: ['a', 'd'], activeId: 'd' })
  })
  it('falls back to the previous tab when everything to the right closes', () => {
    expect(closeTabs(tabs, 'd', ['c', 'd'], id)).toEqual({ tabs: ['a', 'b'], activeId: 'b' })
  })
  it('supports closing the last file tab without mutating the input', () => {
    expect(closeTabs(tabs, 'b', tabs, id)).toEqual({ tabs: [], activeId: null })
    expect(tabs).toEqual(['a', 'b', 'c', 'd'])
  })
  it('ignores stale tab ids', () => {
    expect(closeTabs(tabs, 'c', ['missing'], id)).toEqual({ tabs, activeId: 'c' })
  })
})
