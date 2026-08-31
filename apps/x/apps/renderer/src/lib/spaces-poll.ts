import type { spaces } from '@x/shared'

// /poll — a poll as a markdown convention plus reactions, zero wire change:
// the message lists numbered options, the creator seeds one reaction per
// option (the one-tap vote buttons), and the reaction chips ARE the tally.
// Any client that renders reactions renders the poll. Caveat of the
// convention: the creator's seed reactions read as one vote each — the
// counts everyone compares are still right relative to each other.

const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']

export interface PollInput {
    question: string
    options: string[]
}

/** "question | option | option" → parts, or a usage-error string. */
export function parsePollArgs(args: string): PollInput | string {
    const parts = args.split('|').map((s) => s.trim()).filter(Boolean)
    if (parts.length < 3) return 'Usage: /poll question | option | option [| more…]'
    if (parts.length - 1 > NUMBERS.length) return `Polls take up to ${NUMBERS.length} options`
    const [question, ...options] = parts
    return { question: question!, options }
}

export function buildPollBody({ question, options }: PollInput): string {
    const lines = options.map((option, i) => `${NUMBERS[i]} ${option}`)
    return `📊 **${question}**\n\n${lines.join('\n')}\n\n_Tap a number to vote_`
}

/**
 * Post the poll and seed the vote buttons. Returns the posted message and
 * the final fold (after the seed reactions) — callers echo the first and
 * reconcile with the second.
 */
export async function postPoll(opts: { orgId: string; spaceId: string; topicId: string; input: PollInput }): Promise<{
    posted: spaces.Message
    final: spaces.Message
}> {
    const { orgId, spaceId, topicId, input } = opts
    const result = await window.ipc.invoke('spaces:postMessage', { orgId, spaceId, topicId, body: buildPollBody(input) })
    let final = result.message
    for (let i = 0; i < input.options.length; i++) {
        try {
            const res = await window.ipc.invoke('spaces:reactToMessage', {
                orgId, spaceId, messageId: result.message.id, emoji: NUMBERS[i]!, action: 'add',
            })
            final = res.message
        } catch {
            // A missing button is recoverable — voters can add the emoji.
        }
    }
    return { posted: result.message, final }
}
