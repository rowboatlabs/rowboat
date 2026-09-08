import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import { MessageEditBox } from './edit-box'
import { SpaceProfilesProvider } from './member-text'

// The inline editor mounts a real TipTap instance, a portalled mention menu
// and a layout-effect placement pass. These pin that it comes up clean and
// renders the body it was handed — the app-level check this can't do is
// whether it *looks* right, but a crash or an empty box shows up here.

afterEach(cleanup)

const member = (id: string, displayName: string) => ({ id, displayName, role: 'member' }) as unknown as spaces.Member

function mount(initial: string, onChange = vi.fn()) {
    const utils = render(
        <SpaceProfilesProvider members={[member('01HAAA', 'Harsh')]} here={new Set()} selfId="01HAAA">
            <MessageEditBox initial={initial} onChange={onChange} onSave={vi.fn()} onCancel={vi.fn()} />
        </SpaceProfilesProvider>,
    )
    return { ...utils, onChange }
}

describe('MessageEditBox', () => {
    it('mounts with the body already in the editor', () => {
        mount('hello @Harsh')
        expect(document.querySelector('.ProseMirror')?.textContent).toBe('hello @Harsh')
    })

    it('emits the baseline once on mount, so an untouched draft compares equal', () => {
        const { onChange } = mount('hello @Harsh')
        expect(onChange).toHaveBeenCalledWith('hello @Harsh')
    })

    it('keeps the composer surface: the formatting bar and the growth cap', () => {
        mount('hi')
        expect(screen.getByLabelText(/Bold/i)).toBeTruthy()
        // The edit variant lifts the composer's 10rem cap to half the window.
        expect(document.querySelector('.space-composer.space-composer-edit')).toBeTruthy()
    })

    it('shows no mention menu until an @ is typed', () => {
        mount('hello @Harsh')
        expect(document.querySelector('[data-slot="mention-menu"]')).toBeNull()
    })

    it('renders an empty body without crashing (an image-only message)', () => {
        mount('')
        expect(document.querySelector('.ProseMirror')?.textContent).toBe('')
    })
})
