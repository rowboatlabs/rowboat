import { useEffect, useLayoutEffect, useRef } from 'react'
import { isRichTextTarget } from '@/lib/shortcuts'

/** ⌘B / Ctrl+B toggles the open view's sidebar, in Spaces and Local alike
 *  (2026-11-13). A rich-text editor keeps ⌘B for bold. */
export function useSidebarShortcut(enabled: boolean, toggle: () => void) {
    const toggleRef = useRef(toggle)
    useLayoutEffect(() => { toggleRef.current = toggle })
    useEffect(() => {
        if (!enabled) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'b') return
            if (e.defaultPrevented || isRichTextTarget(e.target)) return
            e.preventDefault()
            toggleRef.current()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [enabled])
}
