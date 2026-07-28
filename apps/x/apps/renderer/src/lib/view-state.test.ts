import { describe, expect, it } from 'vitest'
import {
  APPS_TAB_PATH,
  BG_TASKS_TAB_PATH,
  CHAT_HISTORY_TAB_PATH,
  CODE_TAB_PATH,
  EMAIL_TAB_PATH,
  GRAPH_TAB_PATH,
  HOME_TAB_PATH,
  KNOWLEDGE_VIEW_TAB_PATH,
  LIVE_NOTES_TAB_PATH,
  MEETINGS_TAB_PATH,
  SUGGESTED_TOPICS_TAB_PATH,
  WORKSPACE_TAB_PATH,
  type ViewState,
  viewForTabPath,
} from './view-state'

// Every sentinel tab path and the view it must produce. A sentinel missing its
// branch in viewForTabPath falls through to `{ type: 'file' }`, which renders a
// blank middle pane instead of erroring — the failure mode the ViewState
// collapse exists to make impossible.
const SENTINELS: Array<[string, ViewState['type']]> = [
  [GRAPH_TAB_PATH, 'graph'],
  [SUGGESTED_TOPICS_TAB_PATH, 'suggested-topics'],
  [MEETINGS_TAB_PATH, 'meetings'],
  [LIVE_NOTES_TAB_PATH, 'live-notes'],
  [BG_TASKS_TAB_PATH, 'bg-tasks'],
  [APPS_TAB_PATH, 'apps'],
  [EMAIL_TAB_PATH, 'email'],
  [WORKSPACE_TAB_PATH, 'workspace'],
  [KNOWLEDGE_VIEW_TAB_PATH, 'knowledge-view'],
  [CHAT_HISTORY_TAB_PATH, 'chat-history'],
  [HOME_TAB_PATH, 'home'],
  [CODE_TAB_PATH, 'code'],
]

describe('viewForTabPath', () => {
  it.each(SENTINELS)('maps %s to the %s view', (path, type) => {
    expect(viewForTabPath(path).type).toBe(type)
  })

  it('gives every sentinel a distinct view', () => {
    const types = SENTINELS.map(([path]) => viewForTabPath(path).type)
    expect(new Set(types).size).toBe(SENTINELS.length)
  })

  it('treats a real note path as a file view', () => {
    expect(viewForTabPath('knowledge/Topics/Ada.md')).toEqual({
      type: 'file',
      path: 'knowledge/Topics/Ada.md',
    })
  })

  it('treats a .base path as a file view (bases render from selectedPath)', () => {
    expect(viewForTabPath('knowledge/People.base').type).toBe('file')
  })
})
