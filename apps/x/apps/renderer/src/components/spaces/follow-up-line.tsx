import { X } from 'lucide-react'

// Who a thread reply goes to (Harbor spec §8, 2026-10-27): a reply that
// mentions nobody continues the conversation with the agent the person last
// invoked in the thread. The line says so above the composer, and its × sends
// the next reply to the people only. Hidden while the draft mentions anyone,
// since a mention decides who it goes to.

export function FollowUpLine({ agentName, peopleOnly, onPeopleOnly }: {
    agentName: string
    peopleOnly: boolean
    onPeopleOnly: (peopleOnly: boolean) => void
}) {
    return (
        <div className="shrink-0 px-[16px] pt-2">
            <div role="status" className="flex items-center gap-1.5 px-1 text-xs leading-5 text-muted-foreground">
                {peopleOnly ? (
                    <>
                        <span className="text-xs">To people only</span>
                        <span aria-hidden className="text-xs text-muted-foreground/60">·</span>
                        <button
                            type="button"
                            onClick={() => onPeopleOnly(false)}
                            className="text-xs text-foreground hover:underline"
                        >
                            Include {agentName}
                        </button>
                    </>
                ) : (
                    <>
                        <span className="text-xs">
                            Replying to <span className="font-medium text-foreground">{agentName}</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => onPeopleOnly(true)}
                            aria-label={`Send to people only, not ${agentName}`}
                            title="Send to people only"
                            className="rounded p-0.5 hover:bg-accent hover:text-foreground"
                        >
                            <X className="size-3" />
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}
