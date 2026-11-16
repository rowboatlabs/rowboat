import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SpaceRailSections } from './space-rail-sections'

afterEach(cleanup)

describe('the rail column', () => {
    // Spaces redesign (2026-10-21): Activity is a nav row now, not a bottom panel.
    it('holds only the navigation, with no Activity panel', () => {
        render(<SpaceRailSections>Spaces and DMs</SpaceRailSections>)
        expect(screen.getByText('Spaces and DMs')).toBeVisible()
        expect(screen.queryByRole('region', { name: 'Activity panel' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Activity' })).toBeNull()
        expect(screen.queryByTitle('Drag to resize')).toBeNull()
    })
})
