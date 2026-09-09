import type { spaces } from '@x/shared'
import { requestChatJump, turnInputMessageId } from '@/lib/chat-jump'
import { toast } from '@/lib/toast'

// "Open agent chat" on one of the viewer's own Rowboat posts: resolve the run
// that wrote it (core/spaces/response-index via spaces:responseSession) and
// open the session landing on that run's input. A recorded link whose
// session is gone says so — it never falls through to the thread's session,
// which by then is a fresh one (the registry recreates on demand) and would
// open the wrong conversation. Only an UNRECORDED post (from before the
// index existed) falls back to the thread's session, unanchored.
export async function openResponseChat(input: {
    orgId: string
    spaceId: string
    message: spaces.Message
    onOpenSession: (sessionId: string) => void
}): Promise<void> {
    const { orgId, spaceId, message, onOpenSession } = input
    try {
        const res = await window.ipc.invoke('spaces:responseSession', { orgId, spaceId, messageId: message.id })
        if (res.status === 'found') {
            requestChatJump({ sessionId: res.sessionId, messageId: turnInputMessageId(res.turnId, res.inputIndex) })
            onOpenSession(res.sessionId)
            return
        }
        if (res.status === 'gone') {
            toast('The agent chat that wrote this reply is no longer available', 'info')
            return
        }
        const threadRootId = message.threadRoot ?? message.id
        const { sessionId } = await window.ipc.invoke('spaces:topicSession', { orgId, spaceId, threadRootId })
        if (sessionId) onOpenSession(sessionId)
        else toast('No agent chat recorded for this reply', 'info')
    } catch {
        toast('Could not open the agent chat', 'error')
    }
}
