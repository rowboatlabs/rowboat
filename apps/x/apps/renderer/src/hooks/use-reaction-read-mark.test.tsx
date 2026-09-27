import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReactionReadMark } from './use-reaction-read-mark'
import { markStreamRead, markThreadRead } from '@/lib/spaces-read-state'

vi.mock('@/lib/spaces-read-state', () => ({ markStreamRead: vi.fn(), markThreadRead: vi.fn() }))
let intersect: (entries: Partial<IntersectionObserverEntry>[]) => void
const disconnect = vi.fn()
function Chips({ active = true, offset = 102, threadRootId }: { active?: boolean; offset?: number; threadRootId?: string }) {
    const ref = useReactionReadMark({ orgId: 'org', spaceId: 'dm', threadRootId, offset, active })
    return <div ref={ref}>✅</div>
}
const show = () => act(() => intersect([{ isIntersecting: true, intersectionRatio: 1 }]))
const settle = () => act(() => vi.advanceTimersByTime(300))
beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.stubGlobal('IntersectionObserver', class {
        constructor(callback: typeof intersect) { intersect = callback }
        observe() {}
        disconnect = disconnect
    })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('reaction visibility acknowledgments', () => {
    it('marks the reaction event offset only after the chips are visible', () => {
        render(<Chips />)
        settle()
        expect(markStreamRead).not.toHaveBeenCalled()
        show()
        settle()
        expect(markStreamRead).toHaveBeenCalledWith('org', 'dm', 102)
    })
    it('uses the discussion mark and acknowledges new visible reaction offsets', () => {
        const view = render(<Chips threadRootId="root" />)
        show(); settle()
        expect(markThreadRead).toHaveBeenLastCalledWith('org', 'dm', 'root', 102)
        view.rerender(<Chips threadRootId="root" offset={105} />)
        show(); settle()
        expect(markThreadRead).toHaveBeenLastCalledWith('org', 'dm', 'root', 105)
        expect(markStreamRead).not.toHaveBeenCalled()
    })
    it('cancels acknowledgment when scrolled away, hidden, or unmounted', () => {
        const view = render(<Chips />)
        show()
        act(() => intersect([{ isIntersecting: false, intersectionRatio: 0 }]))
        settle()
        expect(markStreamRead).not.toHaveBeenCalled()
        show()
        view.rerender(<Chips active={false} />)
        settle()
        expect(markStreamRead).not.toHaveBeenCalled()
        view.rerender(<Chips />)
        show()
        view.unmount()
        settle()
        expect(markStreamRead).not.toHaveBeenCalled()
        expect(disconnect).toHaveBeenCalled()
    })
    it('does not acknowledge in the background, then reads when the app gains focus', () => {
        vi.mocked(document.hasFocus).mockReturnValue(false)
        render(<Chips />)
        show(); settle()
        expect(markStreamRead).not.toHaveBeenCalled()
        vi.mocked(document.hasFocus).mockReturnValue(true)
        act(() => window.dispatchEvent(new Event('focus')))
        settle()
        expect(markStreamRead).toHaveBeenCalledWith('org', 'dm', 102)
    })
})
