import { describe, expect, it } from 'vitest'
import { resolveAppChatTarget } from './app-chat-target'

const builder = {
  id: 'builder-tab',
  chatId: 'builder-chat',
  runId: 'app-session'
}
const blank = { id: 'blank-tab', chatId: 'blank-chat', runId: null }

describe('app continuation target', () => {
  it('reuses the saved app session even when another blank chat is active', () => {
    expect(
      resolveAppChatTarget(
        [builder, blank],
        { conversationId: builder.runId },
        { chatId: blank.chatId }
      )
    ).toEqual({ tab: builder, conversationId: builder.runId })
  })
  it('reopens a closed session by its existing ID', () => {
    expect(
      resolveAppChatTarget(
        [blank],
        { conversationId: builder.runId },
        { chatId: blank.chatId }
      )
    ).toEqual({ tab: undefined, conversationId: builder.runId })
  })
  it('retains the chat captured before the picker opened', () => {
    expect(
      resolveAppChatTarget([builder, blank], undefined, {
        chatId: builder.chatId,
        conversationId: builder.runId
      })
    ).toEqual({ tab: builder, conversationId: builder.runId })
  })
  it('follows a draft that acquired a session while the picker was open', () => {
    expect(
      resolveAppChatTarget(
        [builder, blank],
        { chatId: builder.chatId },
        { chatId: blank.chatId, conversationId: 'unrelated-session' }
      )
    ).toEqual({ tab: builder, conversationId: builder.runId })
  })
  it('does not silently fall back to a blank tab when the original draft was closed', () => {
    expect(
      resolveAppChatTarget(
        [blank],
        { chatId: builder.chatId },
        { chatId: blank.chatId }
      )
    ).toEqual({ tab: undefined, conversationId: undefined })
  })
})
