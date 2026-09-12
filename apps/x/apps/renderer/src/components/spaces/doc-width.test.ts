import { describe, expect, it } from 'vitest'
import { clampDocWidth, CHAT_FLOOR, DIVIDER_W, DOC_MIN_WIDTH, SPLIT_FLOOR } from './doc-resize'

// The doc column is sized against the COLUMNS box, never the pane. The rail
// docks in the flow at 220-480px, so a pane measure hands the doc that much
// width it does not have and the chat spills under it.
const chatLeftWith = (columnsWidth: number, desired: number) =>
    columnsWidth - clampDocWidth(columnsWidth, desired) - DIVIDER_W

describe('document column width', () => {
    it('leaves the chat its floor when the reader drags the divider wide open', () => {
        // A 1600px window with the rail docked at 280 leaves 1320 for columns.
        expect(chatLeftWith(1320, 99999)).toBe(CHAT_FLOOR)
    })

    it('honours a width that fits', () => {
        expect(clampDocWidth(1320, 700)).toBe(700)
    })

    it('re-clamps a width persisted before the rail was docked', () => {
        // Sized to 1106 against the full 1600px pane (the old pane-based max),
        // then measured against the columns box the doc actually lives in.
        expect(clampDocWidth(1320, 1106)).toBe(1320 - CHAT_FLOOR - DIVIDER_W)
        expect(chatLeftWith(1320, 1106)).toBe(CHAT_FLOOR)
    })

    it('never returns less than the narrowest useful document', () => {
        expect(clampDocWidth(1320, 10)).toBe(DOC_MIN_WIDTH)
        // Below the split floor the doc gives way first, and the caller has
        // already dropped to a single column.
        expect(clampDocWidth(500, 900)).toBe(DOC_MIN_WIDTH)
    })

    // The property the overlap fix rests on: wherever the view still shows two
    // columns, no drag can take the chat below its floor. Both guards are cut
    // from the same constants, so they cannot drift apart.
    it('leaves the chat whole at every width that still splits', () => {
        for (let columns = SPLIT_FLOOR; columns <= 3000; columns += 7) {
            expect(chatLeftWith(columns, 99999)).toBeGreaterThanOrEqual(CHAT_FLOOR)
            expect(chatLeftWith(columns, DOC_MIN_WIDTH)).toBeGreaterThanOrEqual(CHAT_FLOOR)
        }
    })
})
