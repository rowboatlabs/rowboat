import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { KeepAliveSection } from '@/components/keep-alive-section'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

// A section switch used to strand whatever popover was open: React hides the
// section by setting display:none on its own DOM, which never reaches content
// portalled onto <body>, and the detached refs left the popper at its initial
// position — the top-left corner, over the sidebar, with no trigger to dismiss.
function Harness({ visible }: { visible: boolean }) {
    return (
        <KeepAliveSection visible={visible}>
            <Popover defaultOpen>
                <PopoverTrigger>members</PopoverTrigger>
                <PopoverContent>Members — 4</PopoverContent>
            </Popover>
        </KeepAliveSection>
    )
}

const portalled = () => document.querySelector('[data-radix-popper-content-wrapper]')

describe('KeepAliveSection', () => {
    it('takes an open popover off <body> while the section is hidden, and brings it back', async () => {
        const { rerender } = render(<Harness visible />)
        expect(portalled()).not.toBeNull()
        expect(screen.getByText('Members — 4')).toBeTruthy()

        await act(async () => { rerender(<Harness visible={false} />) })
        expect(portalled()).toBeNull()
        expect(screen.queryByText('Members — 4')).toBeNull()

        await act(async () => { rerender(<Harness visible />) })
        expect(portalled()).not.toBeNull()
        expect(screen.getByText('Members — 4')).toBeTruthy()
    })
})
