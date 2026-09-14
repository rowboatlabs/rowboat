import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BranchDialog } from './branch-dialog'
const invoke = vi.fn()
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Object.assign(window, { ipc: { invoke } })
  invoke.mockResolvedValue({ branches: ['main', 'release'], currentBranch: 'release' })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('branch dialog', () => {
  it('defaults to the worktree base when changing it', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<BranchDialog projectId="p" mode="base" initialBranch="main" onConfirm={onConfirm} onClose={onClose} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change base branch' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Change base branch' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledWith('main')
  })
  it('searches branches and keeps the dialog open if checkout fails', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('Local changes would be overwritten'))
    const onClose = vi.fn()
    render(<BranchDialog projectId="p" mode="switch" onConfirm={onConfirm} onClose={onClose} />)
    await screen.findByRole('option', { name: 'main' })
    fireEvent.change(screen.getByPlaceholderText('Search local branches…'), { target: { value: 'main' } })
    fireEvent.click(screen.getByRole('option', { name: 'main' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch branch' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Local changes would be overwritten')
    expect(onConfirm).toHaveBeenCalledWith('main')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('keeps newest-first order when searching instead of ranking by match quality', async () => {
    invoke.mockResolvedValue({ branches: ['release-feature', 'feature', 'main'], currentBranch: 'main' })
    render(<BranchDialog projectId="p" mode="switch" onConfirm={vi.fn()} onClose={vi.fn()} />)
    await screen.findByRole('option', { name: 'release-feature' })
    fireEvent.change(screen.getByPlaceholderText('Search local branches…'), { target: { value: 'FEATURE' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['release-feature', 'feature'])
    fireEvent.change(screen.getByPlaceholderText('Search local branches…'), { target: { value: '' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['release-feature', 'feature', 'main'])
  })

})
