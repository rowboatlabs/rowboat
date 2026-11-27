/** Ref callback: scrolls a just-mounted name input into view (it takes focus with autoFocus), so a long list never hides it. */
export const revealOnMount = (el: HTMLElement | null) => { el?.scrollIntoView?.({ block: 'nearest' }) }
