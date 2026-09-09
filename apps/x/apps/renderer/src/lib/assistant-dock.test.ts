import { describe, expect, it } from 'vitest'
import { createAssistantTab, restoreAssistantTabs, tabsAfterClose } from './assistant-dock'

describe('assistant dock tabs', () => {
  it('creates independent draft identities and stable session identities', () => {
    const first = createAssistantTab()
    const second = createAssistantTab()
    expect(first.id).not.toBe(second.id)
    expect(first.chatId).not.toBe(second.chatId)
    expect(first.runId).toBeNull()
    expect(createAssistantTab('session').chatId).toBe('session')
  })

  it('restores validated tabs, including unsent drafts', () => {
    const tabs = [createAssistantTab(), createAssistantTab('session')]
    expect(restoreAssistantTabs(JSON.stringify(tabs))).toEqual(tabs)
  })

  it('ignores malformed storage and deduplicates identities', () => {
    expect(restoreAssistantTabs('{')).toEqual([])
    expect(restoreAssistantTabs('{}')).toEqual([])
    expect(restoreAssistantTabs(null)).toEqual([])
    const tab = createAssistantTab('session')
    expect(restoreAssistantTabs(JSON.stringify([null, {}, tab, tab, { ...tab, id: 'other' }, { id: 1 }]))).toEqual([tab])
  })

  it('selects an adjacent chat only when the active tab closes', () => {
    const tabs = [createAssistantTab(), createAssistantTab(), createAssistantTab()]
    expect(tabsAfterClose(tabs, tabs[1].id, tabs[1].id).activeId).toBe(tabs[0].id)
    expect(tabsAfterClose(tabs, tabs[0].id, tabs[0].id).activeId).toBe(tabs[1].id)
    expect(tabsAfterClose(tabs, tabs[1].id, tabs[2].id).activeId).toBe(tabs[2].id)
    expect(tabsAfterClose([tabs[0]], tabs[0].id, tabs[0].id)).toEqual({ tabs: [], activeId: null })
    expect(tabsAfterClose(tabs, 'missing', tabs[0].id).tabs).toEqual(tabs)
  })
})
