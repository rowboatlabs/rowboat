import { useEffect, useRef } from 'react'
import { markStreamRead, markThreadRead } from '@/lib/spaces-read-state'

/** Seeing the reaction advances the same conversation cursor as seeing a message. */
export function useReactionReadMark({ orgId, spaceId, threadRootId, offset, active }: {
    orgId?: string
    spaceId: string
    threadRootId?: string
    offset: number
    active: boolean
}) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const element = ref.current
        if (!element || !orgId || !active || offset <= 0 || typeof IntersectionObserver === 'undefined') return
        let intersecting = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const cancel = () => { clearTimeout(timer); timer = undefined }
        const canRead = () => intersecting && document.visibilityState === 'visible' && document.hasFocus()
            && (element.checkVisibility?.() ?? true)
        const update = () => {
            cancel()
            if (!canRead()) return
            // Avoid acknowledging chips briefly crossed during a jump or scroll.
            timer = setTimeout(() => {
                if (!canRead()) return
                if (threadRootId) markThreadRead(orgId, spaceId, threadRootId, offset)
                else markStreamRead(orgId, spaceId, offset)
            }, 300)
        }
        const observer = new IntersectionObserver(([entry]) => {
            intersecting = !!entry?.isIntersecting && entry.intersectionRatio >= 0.5
            update()
        }, { threshold: 0.5 })
        observer.observe(element)
        window.addEventListener('focus', update)
        window.addEventListener('blur', cancel)
        document.addEventListener('visibilitychange', update)
        return () => {
            cancel()
            observer.disconnect()
            window.removeEventListener('focus', update)
            window.removeEventListener('blur', cancel)
            document.removeEventListener('visibilitychange', update)
        }
    }, [orgId, spaceId, threadRootId, offset, active])
    return ref
}
