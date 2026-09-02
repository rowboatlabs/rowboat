import { useEffect, useState } from 'react'
import { Check, Circle, CircleCheck, Square, SquareCheck } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { MemberAvatar } from '@/components/spaces/atoms'
import { myPollVotes, pollClosed, pollDeadlineLabel, pollVoterCount } from '@/lib/spaces-poll'

// The Discord poll surface, laid out like Discord's: question on top with a
// "Select one (or more) answers" hint, answer rows with the pick control on
// the RIGHT, and a footer of "N votes · 23h left" + Show results + a Vote
// button. Voting is select-then-Vote; results are bars (percent of distinct
// voters) once you've voted, peeked, or the poll closed — winner highlighted
// on close. Voters are visible on hover (votes are not anonymous —
// CONTRACT.md); the author can end early. Renders INSTEAD of the message
// body, which carries the markdown fallback for poll-blind clients.

/** How many voter avatars the hover card shows before collapsing to +N. */
const VOTER_AVATAR_CAP = 8

function joinNames(names: string[]): string {
    if (names.length <= 1) return names[0] ?? ''
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function PollCard({ message, poll, selfMemberId, memberNames, onVote, onRemoveVote, onEndPoll }: {
    message: spaces.Message
    poll: spaces.Poll
    selfMemberId?: string
    memberNames: Map<string, string>
    /** Submit the selection (one id, or several on multiselect). Absent = read-only card. */
    onVote?: (message: spaces.Message, answerIds: number[]) => void
    /** Withdraw all of the viewer's votes. */
    onRemoveVote?: (message: spaces.Message) => void
    /** End the poll now — only offered to the author while it is open. */
    onEndPoll?: (message: spaces.Message) => void
}) {
    // A poll can close while on screen; the tick flips the card to Final
    // results without waiting for a re-render from elsewhere.
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 30_000)
        return () => clearInterval(t)
    }, [])

    const closed = pollClosed(poll, now)
    const mine = myPollVotes(poll, selfMemberId)
    const voted = mine.length > 0
    // Discord's "Show results": peek at the tally without casting a vote.
    const [peeking, setPeeking] = useState(false)
    const showResults = voted || closed || peeking
    const voterCount = pollVoterCount(poll)
    const countOf = (answerId: number) => poll.votes.find((g) => g.answerId === answerId)?.memberIds.length ?? 0
    const topCount = poll.votes.reduce((max, g) => Math.max(max, g.memberIds.length), 0)
    const nameOf = (id: string) => (id === selfMemberId ? 'You' : memberNames.get(id) ?? id)

    const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
    const toggleSelect = (id: number) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else {
                if (!poll.allowMultiselect) next.clear()
                next.add(id)
            }
            return next
        })
    }
    const submit = () => {
        if (!onVote || selected.size === 0) return
        onVote(message, [...selected])
        setSelected(new Set())
        setPeeking(false)
    }

    return (
        <div className="mt-1 w-full max-w-md rounded-lg border border-border bg-muted/40 px-3.5 py-3">
            <div className="text-[15px] font-semibold leading-snug">{poll.question}</div>
            {!showResults && (
                <div className="mt-0.5 text-xs text-muted-foreground">
                    {poll.allowMultiselect ? 'Select one or more answers' : 'Select one answer'}
                </div>
            )}

            <div className="mt-2.5 flex flex-col gap-2">
                {poll.answers.map((answer) => {
                    const count = countOf(answer.id)
                    const percent = voterCount > 0 ? Math.round((count / voterCount) * 100) : 0
                    const isMine = mine.includes(answer.id)
                    const winner = closed && count > 0 && count === topCount
                    if (showResults) {
                        const voters = poll.votes.find((g) => g.answerId === answer.id)?.memberIds ?? []
                        const row = (
                            <div
                                className={cn(
                                    'relative overflow-hidden rounded-md border bg-background/60 px-3 py-2',
                                    winner ? 'border-foreground/40' : 'border-border',
                                )}
                            >
                                {/* The bar IS the background; content sits above it. */}
                                <div
                                    className={cn('absolute inset-y-0 left-0 transition-all duration-300', winner ? 'bg-foreground/15' : 'bg-accent')}
                                    style={{ width: `${percent}%` }}
                                />
                                <div className="relative flex items-center gap-1.5 text-sm">
                                    {answer.emoji && <span className="text-[15px] leading-none">{answer.emoji}</span>}
                                    <span className={cn('min-w-0 flex-1 truncate', winner && 'font-semibold')}>{answer.text}</span>
                                    {isMine && <Check className="size-3.5 shrink-0 text-foreground" />}
                                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{percent}%</span>
                                </div>
                            </div>
                        )
                        return voters.length > 0 ? (
                            <HoverCard key={answer.id} openDelay={250} closeDelay={100}>
                                <HoverCardTrigger asChild>{row}</HoverCardTrigger>
                                <HoverCardContent side="top" className="w-auto max-w-60 p-3">
                                    <div className="flex flex-col items-center gap-1.5 text-center">
                                        <div className="flex flex-wrap items-center justify-center -space-x-1">
                                            {voters.slice(0, VOTER_AVATAR_CAP).map((id) => (
                                                <MemberAvatar key={id} id={id} name={nameOf(id)} size="sm" className="ring-2 ring-popover" />
                                            ))}
                                            {voters.length > VOTER_AVATAR_CAP && (
                                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-popover">
                                                    +{voters.length - VOTER_AVATAR_CAP}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs leading-snug text-muted-foreground">
                                            <span className="font-medium text-foreground">{joinNames(voters.map(nameOf))}</span> voted “{answer.text}”
                                        </p>
                                    </div>
                                </HoverCardContent>
                            </HoverCard>
                        ) : (
                            <div key={answer.id}>{row}</div>
                        )
                    }
                    const picked = selected.has(answer.id)
                    // The pick control rides the RIGHT edge, Discord-style.
                    const PickIcon = poll.allowMultiselect ? (picked ? SquareCheck : Square) : picked ? CircleCheck : Circle
                    return (
                        <button
                            key={answer.id}
                            type="button"
                            disabled={!onVote}
                            onClick={() => toggleSelect(answer.id)}
                            className={cn(
                                'flex items-center gap-2 rounded-md border bg-background/60 px-3 py-2.5 text-left text-sm transition-colors',
                                picked ? 'border-foreground/40 bg-accent' : 'border-border hover:border-foreground/30 hover:bg-accent/40',
                            )}
                        >
                            {answer.emoji && <span className="text-[15px] leading-none">{answer.emoji}</span>}
                            <span className="min-w-0 flex-1 truncate font-medium">{answer.text}</span>
                            <PickIcon className={cn('size-[18px] shrink-0', picked ? 'text-foreground' : 'text-muted-foreground/70')} />
                        </button>
                    )
                })}
            </div>

            <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{voterCount} {voterCount === 1 ? 'vote' : 'votes'}</span>
                <span>·</span>
                <span title={poll.expiresAt}>{pollDeadlineLabel(poll, now)}</span>
                {!closed && onEndPoll && selfMemberId === message.author.memberId && (
                    <>
                        <span>·</span>
                        <button type="button" onClick={() => onEndPoll(message)} className="hover:text-foreground hover:underline">
                            End poll
                        </button>
                    </>
                )}
                <span className="flex-1" />
                {!voted && !closed && onVote && (
                    <button
                        type="button"
                        onClick={() => setPeeking((v) => !v)}
                        className="font-medium hover:text-foreground hover:underline"
                    >
                        {peeking ? 'Hide results' : 'Show results'}
                    </button>
                )}
                {voted && !closed && onRemoveVote && (
                    <button type="button" onClick={() => onRemoveVote(message)} className="font-medium hover:text-foreground hover:underline">
                        Remove vote
                    </button>
                )}
                {!voted && !closed && onVote && !peeking && (
                    <button
                        type="button"
                        onClick={submit}
                        disabled={selected.size === 0}
                        className="rounded-md bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-40"
                    >
                        Vote
                    </button>
                )}
            </div>
        </div>
    )
}
