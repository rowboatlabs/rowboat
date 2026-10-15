import { useEffect, useMemo } from 'react'
import { useSpacesUnreadCounts } from '@/hooks/use-space-chat'

// The tab says what's waiting (2026-10-15), by the desktop dock badge's rule
// (main/src/dock-badge.ts): how many messages are for you, else a dot when
// anything is unread. The title carries it, and so does the icon, for a
// pinned tab, which shows no title.

const BASE_TITLE = 'Rowboat Spaces'
const ICON = '/logo-only.png'

export function tabTitle({ unread, forYou }: { unread: number; forYou: number }): string {
    if (forYou > 0) return `(${forYou}) ${BASE_TITLE}`
    if (unread > 0) return `• ${BASE_TITLE}`
    return BASE_TITLE
}

let iconImage: Promise<HTMLImageElement> | null = null
function loadIcon(): Promise<HTMLImageElement> {
    iconImage ??= new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = ICON
    })
    return iconImage
}

/** The icon with a dot in its corner: red for messages for you, grey for anything else unread. */
async function setTabIcon(dot: 'for-you' | 'unread' | null): Promise<void> {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    if (!dot) {
        link.href = ICON
        return
    }
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(await loadIcon(), 0, 0, size, size)
    ctx.beginPath()
    ctx.arc(size - 14, 14, 13, 0, Math.PI * 2)
    ctx.fillStyle = dot === 'for-you' ? '#e5484d' : '#8b8d98'
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    link.href = canvas.toDataURL('image/png')
}

export function useTabBadge(): void {
    const counts = useSpacesUnreadCounts()
    const total = useMemo(() => {
        let unread = 0
        let forYou = 0
        for (const badge of counts.values()) {
            unread += badge.unread
            forYou += badge.forYou
        }
        return { unread, forYou }
    }, [counts])
    useEffect(() => {
        document.title = tabTitle(total)
        void setTabIcon(total.forYou > 0 ? 'for-you' : total.unread > 0 ? 'unread' : null).catch(() => {})
    }, [total])
}
