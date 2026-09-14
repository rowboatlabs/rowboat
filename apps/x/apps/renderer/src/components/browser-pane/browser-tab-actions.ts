export async function closeOtherBrowserTabs(keepTabId: string): Promise<void> {
  // Read current native state: the rail's rendered list may already be stale.
  const state = await window.ipc.invoke('browser:getState', null)
  if (!state.tabs.some((tab) => tab.id === keepTabId)) return
  if (state.activeTabId !== keepTabId) {
    const switched = await window.ipc.invoke('browser:switchTab', { tabId: keepTabId })
    if (!switched.ok) throw new Error('Could not activate the tab to keep')
  }
  for (const tab of state.tabs) {
    if (tab.id === keepTabId) continue
    const closed = await window.ipc.invoke('browser:closeTab', { tabId: tab.id })
    if (!closed.ok) throw new Error('Could not close a browser tab')
  }
}
