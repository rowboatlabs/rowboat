import { beforeEach, describe, expect, it, vi } from 'vitest'

// The app's notices go to sonner, which both apps render (2026-10-15).

const sonner = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: sonner }))

const { toast } = await import('./toast')

describe('toast', () => {
    beforeEach(() => {
        sonner.mockClear()
        sonner.success.mockClear()
        sonner.error.mockClear()
    })

    it('draws each kind through sonner', () => {
        toast('Copied', 'success')
        toast('Could not join', 'error')
        toast('No agent chat for this thread yet')
        expect(sonner.success).toHaveBeenCalledWith('Copied', { id: 'success:Copied' })
        expect(sonner.error).toHaveBeenCalledWith('Could not join', { id: 'error:Could not join' })
        expect(sonner).toHaveBeenCalledWith('No agent chat for this thread yet', { id: 'info:No agent chat for this thread yet' })
    })

    it('gives the same message the same id, so it replaces rather than stacks', () => {
        toast('This invite is not found', 'error')
        toast('This invite is not found', 'error')
        const ids = sonner.error.mock.calls.map((call) => (call[1] as { id: string }).id)
        expect(new Set(ids).size).toBe(1)
    })
})
