import { describe, expect, it } from 'vitest'
import {
  groupConversationItems,
  getWebSearchGroupStatus,
  isWebSearchGroup,
  type ChatMessage,
  type ToolCall,
} from './chat-conversation'

const makeWebSearch = (id: string, query: string): ToolCall => ({
  id,
  name: 'web-search',
  input: { query },
  result: { results: [] },
  status: 'completed',
  timestamp: 1,
})

describe('getWebSearchGroupStatus', () => {
  it('stays running while any query is pending or running', () => {
    const completed = makeWebSearch('search-1', 'React testing')
    const failed = { ...makeWebSearch('search-2', 'Vitest mocks'), status: 'error' as const }
    const running = { ...makeWebSearch('search-3', 'Testing hooks'), status: 'running' as const }

    expect(getWebSearchGroupStatus([completed, failed, running])).toBe('running')
  })

  it('reports an error after all queries settle if any failed', () => {
    const completed = makeWebSearch('search-1', 'React testing')
    const failed = { ...makeWebSearch('search-2', 'Vitest mocks'), status: 'error' as const }

    expect(getWebSearchGroupStatus([completed, failed])).toBe('error')
  })

  it('reports completion when every query completed', () => {
    expect(getWebSearchGroupStatus([
      makeWebSearch('search-1', 'React testing'),
      makeWebSearch('search-2', 'Vitest mocks'),
    ])).toBe('completed')
  })
})

const makeTool = (id: string, name = 'file-readText'): ToolCall => ({
  id,
  name,
  input: {},
  status: 'completed',
  timestamp: 1,
})

const makeMessage = (id: string): ChatMessage => ({
  id,
  role: 'assistant',
  content: 'Done',
  timestamp: 1,
})

const group = (items: Array<ToolCall | ChatMessage>) =>
  groupConversationItems(items, () => false)

describe('groupConversationItems web searches', () => {
  it('keeps a single web search as its existing standalone card', () => {
    const search = makeWebSearch('search-1', 'React testing')

    expect(group([search])).toEqual([search])
  })

  it('groups two or more consecutive web searches', () => {
    const first = makeWebSearch('search-1', 'React testing')
    const second = makeWebSearch('search-2', 'Vitest mocks')
    const third = makeWebSearch('search-3', 'Testing hooks')
    const [result] = group([first, second, third])

    expect(isWebSearchGroup(result)).toBe(true)
    if (!isWebSearchGroup(result)) throw new Error('Expected a web-search group')
    expect(result.groupId).toBe(first.id)
    expect(result.items).toEqual([first, second, third])
  })

  it('ends a web-search group at a message boundary', () => {
    const first = makeWebSearch('search-1', 'React testing')
    const second = makeWebSearch('search-2', 'Vitest mocks')
    const message = makeMessage('message-1')
    const third = makeWebSearch('search-3', 'Testing hooks')

    const result = group([first, second, message, third])

    expect(result).toHaveLength(3)
    expect(isWebSearchGroup(result[0])).toBe(true)
    expect(result[1]).toBe(message)
    expect(result[2]).toBe(third)
  })

  it('ends a web-search group at a different tool call', () => {
    const first = makeWebSearch('search-1', 'React testing')
    const second = makeWebSearch('search-2', 'Vitest mocks')
    const fileTool = makeTool('tool-1')
    const third = makeWebSearch('search-3', 'Testing hooks')

    const result = group([first, second, fileTool, third])

    expect(result).toHaveLength(3)
    expect(isWebSearchGroup(result[0])).toBe(true)
    expect(result[1]).toBe(fileTool)
    expect(result[2]).toBe(third)
  })
})
