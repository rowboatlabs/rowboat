import { useEffect, useState } from 'react'

// Whether the window is in macOS full screen, where the traffic lights are
// hidden (2026-10-21: the toolbar then moves left into their place). A full-
// screen window covers the whole display, menu bar included; a zoomed window
// stops below the menu bar, so it never matches.
function isFullScreen(): boolean {
    return window.outerWidth >= window.screen.width && window.outerHeight >= window.screen.height
}

export function useFullScreen(): boolean {
    const [fullScreen, setFullScreen] = useState(isFullScreen)
    useEffect(() => {
        const update = () => setFullScreen(isFullScreen())
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
    }, [])
    return fullScreen
}
