import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptsView } from './prompts-view'

// The Prompts page (Baarali, 03/10/2026): use a prompt, keep a favourite,
// improve one in the workshop.

const invoke = vi.fn()
beforeEach(() => {
  invoke.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'workspace:readFile') throw new Error('missing')
    if (channel === 'billing:getInfo') return { subscriptionPlanId: null }
    if (channel === 'llm:generate') return { text: 'PROMPT:\nAffiche [boutique]\nPOURQUOI:\n- précis\nVARIANTES:\n- carrée\nASTUCE:\nLe prix.' }
    return {}
  })
  ;(window as unknown as { ipc: { invoke: typeof invoke } }).ipc = { invoke }
  document.documentElement.lang = 'en'
})
afterEach(() => cleanup())

describe('PromptsView', () => {
  it('opens a chat with a library prompt written in', () => {
    const onUse = vi.fn()
    render(<PromptsView onUse={onUse} />)
    fireEvent.click(screen.getAllByText('Use')[0])
    expect(onUse).toHaveBeenCalledWith(expect.stringContaining('[paste their message]'))
  })

  it('filters by category and by search', () => {
    render(<PromptsView onUse={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }))
    expect(screen.getByText('A clean quote')).toBeTruthy()
    expect(screen.queryByText('Answer a complaint')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('Search for a prompt…'), { target: { value: 'agreement' } })
    expect(screen.queryByText('A clean quote')).toBeNull()
    expect(screen.getByText('A simple service agreement')).toBeTruthy()
  })

  it('keeps a favourite in the workspace', async () => {
    render(<PromptsView onUse={() => {}} />)
    fireEvent.click(screen.getAllByLabelText('Add to favorites')[0])
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('workspace:writeFile', expect.objectContaining({ path: 'config/baarali-prompts.json' })))
  })

  it('improves a prompt in the workshop and shows its parts', async () => {
    render(<PromptsView onUse={() => {}} />)
    fireEvent.click(screen.getAllByText('Improve')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Improve' }))
    await waitFor(() => expect(screen.getByText('Affiche [boutique]')).toBeTruthy())
    expect(screen.getByText('précis')).toBeTruthy()
    expect(screen.getByText('Save in My prompts')).toBeTruthy()
  })
})
