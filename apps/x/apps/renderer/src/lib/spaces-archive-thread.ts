import type { spaces } from '@x/shared'
import { ingestTopic } from '@/hooks/use-space-chat'
import { invokeSpace } from '@/lib/spaces-invoke'
import { threadLabelOf } from '@/lib/spaces-conventions'

/**
 * Archive a thread that has no discussion row (2026-11-03, "archive threads"
 * in Main: plain threads archive just like named ones). Archive lives on the
 * topic annotation, so the thread is first named after its first line — the
 * same label the Threads view already shows — and then archived. A reply
 * revives it as a named thread; "Convert back to thread" drops the name.
 */
export async function archivePlainThread(orgId: string, spaceId: string, rootMessageId: string, rootBody: string): Promise<spaces.Topic> {
    const { topic: created } = await invokeSpace('spaces:createTopic', { orgId, spaceId, rootMessageId, title: threadLabelOf(rootBody) })
    ingestTopic(orgId, spaceId, created)
    const { topic } = await invokeSpace('spaces:manageTopic', { orgId, spaceId, topicId: created.id, action: { action: 'archive' } })
    ingestTopic(orgId, spaceId, topic)
    return topic
}
