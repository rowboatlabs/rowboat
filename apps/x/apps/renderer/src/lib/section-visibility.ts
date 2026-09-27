import { createContext, useContext } from 'react'

// Whether the keep-alive section around you is currently on screen.
//
// A middle-pane section stays mounted once visited (see KeepAliveSection), and
// React hides it by setting `display: none` on the section's own DOM — state,
// scroll and the DOM survive, so switching back is instant.
//
// The catch: an overlay's content is portalled onto <body>, which is outside
// the section's DOM, so React's hide never reaches it. Worse, hiding a section
// detaches the refs inside it, and a popper with no floating ref falls back to
// its initial `position: fixed; left: 0; top: 0`. A popover left open in the
// section you just walked away from therefore reappears in the top-left corner,
// over the sidebar, with its trigger hidden and nothing left to click to
// dismiss it.
//
// So the section publishes whether it is on screen, and the overlay primitives
// in components/ui refuse to portal anything while it isn't.
export const SectionVisibleContext = createContext(true)

/** False while the surrounding keep-alive section is hidden off-screen. */
export function useSectionVisible(): boolean {
  return useContext(SectionVisibleContext)
}
