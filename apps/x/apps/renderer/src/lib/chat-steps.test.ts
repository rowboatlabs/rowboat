import { describe, expect, it } from 'vitest'
import { getToolRowSummary, groupConversationItems, type ConversationItem, type ToolCall } from './chat-conversation'
import { isBackstage, shownSteps } from './chat-steps'

// BAARALI(05/10/2026): the chat an image request used to show, step by step.
const tool = (id: string, name: string, input: Record<string, unknown> = {}, status: ToolCall['status'] = 'completed'): ToolCall =>
  ({ id, name, input, status, timestamp: 0 }) as ToolCall
const thought = (id: string, streaming = false): ConversationItem => ({ id, kind: 'reasoning', content: '…', timestamp: 0, streaming })
const user: ConversationItem = { id: 'u', role: 'user', content: 'Génère une image d’un lion', timestamp: 0 }

describe('the chat without its backstage', () => {
  it('shows an image request as the image step alone', () => {
    const items: ConversationItem[] = [
      user,
      thought('r1'),
      tool('t1', 'loadSkill', { skillName: 'builtin-tools' }),
      thought('r2'),
      tool('t2', 'listMcpServers'),
      tool('t3', 'executeMcpTool', { serverName: 'baarali-media', toolName: 'list_models' }),
      tool('t4', 'generate-image', { prompt: 'a lion at sunset' }),
    ]
    expect(shownSteps(items).map((i) => i.id)).toEqual(['u', 't4'])
  })

  it('keeps the thinking while it streams, and hides a backstage step even when it failed', () => {
    expect(isBackstage(thought('r', true))).toBe(false)
    expect(isBackstage(tool('t', 'loadSkill', {}, 'error'))).toBe(true)
    expect(isBackstage(tool('t', 'generate-image', {}, 'error'))).toBe(false)
    expect(isBackstage(tool('t', 'loadSkill', {}, 'running'))).toBe(true)
    expect(isBackstage(tool('t', 'executeMcpTool', { serverName: 'baarali-media', toolName: 'generate' }))).toBe(false)
  })

  it('joins the real steps a thought used to split into one group', () => {
    const items = shownSteps([tool('a', 'file-readText'), thought('r'), tool('b', 'file-readText')])
    const grouped = groupConversationItems(items, () => false)
    expect(grouped).toHaveLength(1)
  })

  it('says what the image step is doing, then what it did', () => {
    expect(getToolRowSummary(tool('t', 'generate-image', { prompt: 'a lion' }, 'running')).verb).toBe('Creating the image')
    expect(getToolRowSummary(tool('t', 'generate-image', { prompt: 'a lion' })).verb).toBe('Image created')
    const generate = tool('m', 'executeMcpTool', { serverName: 'baarali-media', toolName: 'generate' }, 'running')
    expect(getToolRowSummary(generate).verb).toBe('Starting the creation')
  })
})
