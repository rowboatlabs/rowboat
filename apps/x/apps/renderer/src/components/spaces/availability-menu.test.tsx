import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AvailabilityEditor } from './availability-menu'

afterEach(cleanup)
it('saves schedule days, timezone and hours independently of presence', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<AvailabilityEditor mode="schedule" busy={false} error="" onSave={save} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Use a notification schedule'))
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Asia/Kolkata' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '10:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ schedule: { days: [1, 2, 3, 4, 5], start: '10:00', end: '17:00', timeZone: 'Asia/Kolkata' }, resumedUntil: null }))
})
it('rejects an invalid timezone without sending a write', () => {
    const save = vi.fn()
    render(<AvailabilityEditor mode="schedule" busy={false} error="" onSave={save} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText('Use a notification schedule'))
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'not-a-timezone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid hours')
    expect(save).not.toHaveBeenCalled()
})
it('saves a custom status with expiry and optional notification pause', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<AvailabilityEditor mode="status" busy={false} error="" onSave={save} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'In a meeting' } })
    fireEvent.change(screen.getByLabelText('Emoji'), { target: { value: '📅' } })
    fireEvent.click(screen.getByLabelText('Pause notifications until status clears'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    const patch = save.mock.calls[0][0]
    expect(patch.status).toMatchObject({ text: 'In a meeting', emoji: '📅' })
    expect(patch.status.pauseNotifications).toBe(true)
    expect(Date.parse(patch.status.expiresAt)).toBeGreaterThan(Date.now())
    expect(patch).not.toHaveProperty('manualAway')
})
