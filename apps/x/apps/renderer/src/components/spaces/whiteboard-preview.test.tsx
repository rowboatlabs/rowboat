import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { SpaceAccessContext, setSpacePreview } from '@/lib/spaces-access'

const mocks = vi.hoisted(() => ({ props: {} as Record<string, unknown>, frame: (_frame: spaces.ServerFrame) => {}, saver: vi.fn() }))
vi.mock('@/contexts/theme-context', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@/hooks/use-spaces', () => ({ useSpaceLive: (_org: string, _space: string, handler: typeof mocks.frame) => { mocks.frame = handler } }))
vi.mock('@/lib/whiteboard-saver', () => ({ createBoardSaver: mocks.saver }))
vi.mock('@excalidraw/excalidraw', () => ({
    Excalidraw: (props: Record<string, unknown>) => {
        mocks.props = props
        useEffect(() => {
            const ready = props.excalidrawAPI as (api: unknown) => void
            ready({ getSceneElementsIncludingDeleted: () => [], getAppState: () => ({}), updateScene: vi.fn() })
        }, [])
        return <div>Board</div>
    },
    FONT_FAMILY: { Nunito: 1 }, CaptureUpdateAction: { NEVER: 'never' },
    getSceneVersion: () => 0, reconcileElements: (_local: unknown, remote: unknown) => remote, restoreElements: (elements: unknown) => elements,
    MainMenu: Object.assign(() => null, { DefaultItems: { SaveAsImage: () => null, ClearCanvas: () => null, ChangeCanvasBackground: () => null } }),
    WelcomeScreen: Object.assign(() => null, { Center: Object.assign(() => null, { Logo: () => null, Heading: () => null }) }),
}))
import WhiteboardPane from './whiteboard-pane'
afterEach(() => { cleanup(); setSpacePreview('board-org', 'space', false); vi.useRealTimers() })
it('loads and refreshes a preview board without a saver or outbound frames, including cleanup', async () => {
    vi.useFakeTimers()
    setSpacePreview('board-org', 'space', true)
    const invoke = vi.fn().mockResolvedValue({ version: 1, path: 'whiteboards/test.excalidraw', content: '{"elements":[]}' })
    vi.stubGlobal('ipc', { invoke })
    const org = { id: 'board-org', memberId: 'me', address: 'test' } as OrgWithSpaces
    const space = { id: 'space', name: 'Open', visibility: 'open', kind: 'shared' } as spaces.Space
    let unmount!: () => void
    await act(async () => {
        unmount = render(<SpaceAccessContext.Provider value={{ member: false, joining: false, join: vi.fn() }}>
            <WhiteboardPane org={org} space={space} boardId="board" memberNames={new Map()} active boards={[]} onSelectBoard={vi.fn()} onCreateBoard={vi.fn()} onClose={vi.fn()} />
        </SpaceAccessContext.Provider>).unmount
    })
    expect(mocks.props.viewModeEnabled).toBe(true)
    expect(mocks.props.onChange).toBeUndefined()
    expect(mocks.props.onPointerUpdate).toBeUndefined()
    expect(mocks.saver).not.toHaveBeenCalled()
    await act(async () => {
        mocks.frame({ kind: 'subscribed', spaceId: 'space', fromOffset: 1 } as spaces.ServerFrame)
        await vi.advanceTimersByTimeAsync(60_000)
    })
    unmount()
    expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(invoke.mock.calls.every(([channel]) => channel === 'spaces:readAsset')).toBe(true)
})
