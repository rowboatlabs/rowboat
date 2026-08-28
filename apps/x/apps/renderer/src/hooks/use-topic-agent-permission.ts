import { useEffect, useState } from 'react'
import { outstandingPermissions, reduceTurn } from '@x/shared/src/turns.js'
import type { SessionLatestTurnStatus } from '@x/shared/src/sessions.js'
import { ipcSessionsClient } from '@/lib/session-chat/client'
import { subscribeSessionFeed } from '@/lib/session-chat/feed'

// A topic's own-agent session can suspend mid-turn waiting for a tool
// permission — invisible from the space (the working lease keeps spinning,
// or expires, and the agent just idles). This watches the session index for
// the topic's session and, when its latest turn is suspended, fetches the
// turn to see whether permissions (not async tools) are what it waits on.

/** Tool names the topic's agent is blocked on, oldest first ([] = not blocked). */
export function useTopicAgentPermissionWait(
    orgId: string,
    spaceId: string,
    topicId: string | null,
    /** Gate for kept-alive hidden panes — no watching while off screen. */
    enabled: boolean,
): string[] {
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [tools, setTools] = useState<string[]>([])

    useEffect(() => {
        let cancelled = false
        setSessionId(null)
        if (!topicId || !enabled) return
        void window.ipc
            .invoke('spaces:topicSession', { orgId, spaceId, topicId })
            .then((res) => {
                if (!cancelled) setSessionId(res.sessionId ?? null)
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [orgId, spaceId, topicId, enabled])

    useEffect(() => {
        setTools([])
        if (!sessionId || !enabled) return
        let cancelled = false
        const check = (turnId: string | undefined, status: SessionLatestTurnStatus) => {
            // "suspended" covers async tools too — only a fetched turn can say
            // whether an unresolved permission is what holds it.
            if (status !== 'suspended' || !turnId) {
                setTools([])
                return
            }
            void ipcSessionsClient
                .getTurn(turnId)
                .then(({ events }) => {
                    if (cancelled) return
                    setTools(outstandingPermissions(reduceTurn(events)).map((tc) => tc.toolName))
                })
                .catch(() => {})
        }
        void ipcSessionsClient
            .list()
            .then(({ sessions }) => {
                if (cancelled) return
                const entry = sessions.find((s) => s.sessionId === sessionId)
                if (entry) check(entry.latestTurnId, entry.latestTurnStatus)
            })
            .catch(() => {})
        const off = subscribeSessionFeed((event) => {
            if (event.kind !== 'index-changed' || event.sessionId !== sessionId) return
            if (!event.entry) setTools([])
            else check(event.entry.latestTurnId, event.entry.latestTurnStatus)
        })
        return () => {
            cancelled = true
            off()
        }
    }, [sessionId, enabled])

    return tools
}
