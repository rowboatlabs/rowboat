import { describe, expect, it } from 'vitest'
import { assistantDockTabs, createAssistantTab, replaceAssistantTab, restoreAssistantTabs, tabsAfterClose } from './assistant-dock'

describe('assistant dock tabs', () => {
  it('hides the full-screen chat without deleting it or hiding other chats', () => {
    const tabs = [createAssistantTab(), createAssistantTab('other'), createAssistantTab('docked')]
    expect(assistantDockTabs(tabs, tabs[2].id, tabs[0].id)).toEqual([tabs[1], tabs[2]])
    expect(assistantDockTabs(tabs, tabs[2].id, null)).toEqual(tabs.slice(0, 2))
    expect(tabs).toHaveLength(3)
  })

  it('replaces a conversation in place, preserving panel identity and other tabs', () => {
    const tabs = [createAssistantTab('old'), createAssistantTab('other')]
    const switched = replaceAssistantTab(tabs, tabs[0].id, 'selected', 'selected-identity')
    expect(switched).toHaveLength(2)
    expect(switched[0]).toEqual({ id: tabs[0].id, runId: 'selected', chatId: 'selected-identity' })
    expect(switched[1]).toBe(tabs[1])
    const fresh = replaceAssistantTab(switched, tabs[0].id, null, 'fresh-draft')
    expect(fresh[0]).toEqual({ id: tabs[0].id, runId: null, chatId: 'fresh-draft' })
    expect(replaceAssistantTab(tabs, 'closed-panel', 'selected', 'selected')).toEqual(tabs)
  })
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
