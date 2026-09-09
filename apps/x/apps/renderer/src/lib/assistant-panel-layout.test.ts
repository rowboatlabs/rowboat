import { describe, expect, it } from 'vitest'
import { clampPanelSize, layoutAssistantPanels, restorePanelPreferences } from './assistant-panel-layout'

describe('assistant panel layout', () => {
  it('keeps the focused panel reachable without moving panels that still fit', () => {
    const viewport = { width: 1400, height: 900 }
    expect(layoutAssistantPanels(['first', 'second'], {}, viewport, 0, 'first')).toEqual(layoutAssistantPanels(['first', 'second'], {}, viewport, 0, 'second'))
    expect(Object.keys(layoutAssistantPanels(['first', 'second'], {}, { width: 800, height: 700 }, 0, 'first'))).toEqual(['first'])
  })
  it('tiles independent sizes without overlaps', () => {
    const layout = layoutAssistantPanels(['first', 'second'], { first: { width: 360, height: 400 }, second: { width: 500, height: 650 } }, { width: 1400, height: 900 })
    expect(layout.second).toEqual({ width: 500, height: 650, right: 12 })
    expect(layout.first).toEqual({ width: 360, height: 400, right: 524 })
  })
  it('folds older panels on small windows and restores them as space returns', () => {
    const ids = ['first', 'second', 'third']
    expect(Object.keys(layoutAssistantPanels(ids, {}, { width: 800, height: 700 }))).toEqual(['third'])
    expect(Object.keys(layoutAssistantPanels(ids, {}, { width: 1500, height: 900 }))).toEqual(['third', 'second', 'first'])
  })
  it('reserves the actual docked sidebar width', () => {
    const layout = layoutAssistantPanels(['first', 'second'], {}, { width: 1400, height: 900 }, 460)
    expect(layout.second.right).toBe(472)
    expect(layout.first.right).toBe(904)
  })
  it('clamps tiny windows and invalid dimensions safely', () => {
    expect(clampPanelSize({ width: Infinity, height: NaN }, { width: 1000, height: 800 })).toEqual({ width: 420, height: 600 })
    expect(clampPanelSize({ width: 9999, height: 9999 }, { width: 300, height: 300 })).toEqual({ width: 212, height: 192 })
    expect(layoutAssistantPanels(['first', 'first'], {}, { width: 1000, height: 800 })).toHaveProperty('first')
  })
  it('validates saved preferences rather than trusting local storage', () => {
    expect(restorePanelPreferences('{broken')).toEqual({ sizes: {}, expanded: [], docked: null })
    expect(restorePanelPreferences(JSON.stringify({ sizes: { good: { width: 400, height: 500 }, bad: { width: 'huge' } }, expanded: ['good', 123], docked: 'good' }))).toEqual({ sizes: { good: { width: 400, height: 500 } }, expanded: ['good'], docked: 'good' })
  })
})
