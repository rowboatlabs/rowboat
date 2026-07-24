import { Message, MessageContent } from '@/components/ai-elements/message'
import type { BillingErrorMatch } from '@/lib/billing-error'

/**
 * Inline transcript notice for billing failures (out of credits, subscription
 * required/inactive). The BillingErrorDialog is the attention-grabber; this
 * stays in the conversation so the turn never ends silently blank if the
 * dialog is dismissed or missed.
 */
export function BillingErrorNotice({ id, match }: { id: string; match: BillingErrorMatch }) {
  return (
    <Message from="assistant" data-message-id={id}>
      <MessageContent className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
        <p className="text-sm font-medium text-foreground">{match.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{match.subtitle}</p>
      </MessageContent>
    </Message>
  )
}
