import { useLayoutEffect, type RefObject } from 'react'

/** Gap kept between a header title and the centred Spaces | Local tabs. */
const GAP = 8

/** The Spaces | Local tabs float over the titlebar's centre (App.tsx
 *  AppModeTabs), so a long header title ran under them (2026-11-13). Caps the
 *  title's width at the tabs' left edge whenever it shares their band. */
export function useTitlebarTabsClearance(ref: RefObject<HTMLElement | null>) {
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const update = () => {
            const tabs = document.querySelector<HTMLElement>('[data-app-mode-tabs]')
            el.style.maxWidth = ''
            if (!tabs) return
            const t = tabs.getBoundingClientRect()
            const r = el.getBoundingClientRect()
            const sameBand = r.top < t.bottom && r.bottom > t.top
            if (!sameBand || r.left >= t.right) return
            el.style.maxWidth = `${Math.max(0, t.left - GAP - r.left)}px`
        }
        update()
        // The title moves when a sidebar opens or the window resizes; its parent's size tracks both.
        const ro = new ResizeObserver(update)
        if (el.parentElement) ro.observe(el.parentElement)
        ro.observe(document.documentElement)
        window.addEventListener('resize', update)
        return () => {
            ro.disconnect()
            window.removeEventListener('resize', update)
        }
    })
}
