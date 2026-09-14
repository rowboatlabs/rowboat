import type { message } from '@x/shared'
import type { FileMention, Mention } from '@/components/ai-elements/prompt-input'

// The composer's @ picks split two ways at send (2026-09-12): a knowledge
// file is CONTENT — it becomes an attachment part the runtime reads — while
// a space, a board or a person is CONTEXT: the ids ride
// userMessageContext.spaceMentions so the model acts on exactly what was
// picked. Both send paths (the chat composer and the hover bar) go through
// here so they cannot drift.

export type SpaceMentionRef = message.SpaceMentionRef

export function splitMentions(mentions: Mention[] | undefined): {
  fileMentions: FileMention[]
  spaceMentions: SpaceMentionRef[]
} {
  const fileMentions: FileMention[] = []
  const spaceMentions: SpaceMentionRef[] = []
  for (const mention of mentions ?? []) {
    switch (mention.kind) {
      case 'file':
        fileMentions.push(mention)
        break
      case 'space':
        spaceMentions.push({
          kind: 'space',
          orgId: mention.orgId,
          orgName: mention.orgName,
          spaceId: mention.spaceId,
          name: mention.displayName,
        })
        break
      case 'board':
        spaceMentions.push({
          kind: 'board',
          orgId: mention.orgId,
          orgName: mention.orgName,
          spaceId: mention.spaceId,
          spaceName: mention.spaceName,
          path: mention.path,
          name: mention.displayName,
        })
        break
      case 'member':
        spaceMentions.push({
          kind: 'member',
          orgId: mention.orgId,
          orgName: mention.orgName,
          memberId: mention.memberId,
          displayName: mention.displayName,
        })
        break
    }
  }
  return { fileMentions, spaceMentions }
}
