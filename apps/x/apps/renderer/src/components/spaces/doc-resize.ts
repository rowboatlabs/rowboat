// Sizing for the document column and the divider beside it. Every width here
// is measured against the COLUMNS box — the flex row holding chat + divider +
// doc — and never against the pane: the rail docks IN THE FLOW at a width the
// reader drags (220-480px), so a pane that clears a floor can leave the
// columns far short of it. Measuring the pane was the old bug; the doc grew
// past what the row had and the chat spilled under it.

/** Chat never squeezes below this beside a doc; the doc takes the rest. */
export const CHAT_FLOOR = 460

/** Narrowest useful document column. */
export const DOC_MIN_WIDTH = 420

/** The divider between two columns (w-1.5). */
export const DIVIDER_W = 6

/**
 * Two columns need this much of the columns box. Derived from the same parts
 * the clamp below uses, so the split decision and the width it produces can
 * never disagree: above this floor clampDocWidth always leaves CHAT_FLOOR.
 */
export const SPLIT_FLOOR = CHAT_FLOOR + DOC_MIN_WIDTH + DIVIDER_W

/**
 * The doc's settled width beside the chat. The chat keeps CHAT_FLOOR no
 * matter what is dragged or restored from a previous window; when even the
 * floors don't fit, the doc gives way first (it is the column being sized,
 * and the caller has already dropped to one column below SPLIT_FLOOR).
 */
export function clampDocWidth(columnsWidth: number, desired: number): number {
    const max = Math.max(DOC_MIN_WIDTH, columnsWidth - CHAT_FLOOR - DIVIDER_W)
    return Math.round(Math.max(DOC_MIN_WIDTH, Math.min(desired, max)))
}
