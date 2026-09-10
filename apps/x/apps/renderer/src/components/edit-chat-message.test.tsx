import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditChatMessage } from './edit-chat-message'

afterEach(cleanup)
describe('editing a chat prompt', () => {
  it('keeps an unsuccessful edit available and closes only after successful submission', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(undefined)
    render(<EditChatMessage text="Original" onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    expect(screen.getByRole('button', { name: 'Save & submit' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Revised message' }), { target: { value: 'Revised' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & submit' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Offline'))
    expect(screen.getByRole('textbox')).toHaveValue('Revised')
    fireEvent.click(screen.getByRole('button', { name: 'Save & submit' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('Revised')
  })
  it('cancel never submits an edit', () => {
    const save = vi.fn()
    render(<EditChatMessage text="Original" onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(save).not.toHaveBeenCalled()
  })
})
