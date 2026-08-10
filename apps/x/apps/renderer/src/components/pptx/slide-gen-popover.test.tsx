import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlideGenPopover } from './slide-gen-popover'

// Radix Popover needs these in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
Element.prototype.scrollIntoView = () => {}
;(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
;(Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {}
;(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {}

afterEach(cleanup)

function openCardPopover(props: Partial<React.ComponentProps<typeof SlideGenPopover>> = {}) {
  const onGenerate = vi.fn(async () => ({}))
  const onEdit = vi.fn(async () => ({}))
  render(
    <SlideGenPopover
      onGenerate={onGenerate}
      onEdit={onEdit}
      defaultMode="edit"
      trigger={<button type="button">sparkle</button>}
      {...props}
    />,
  )
  fireEvent.click(screen.getByText('sparkle'))
  return { onGenerate, onEdit }
}

describe('SlideGenPopover', () => {
  it('opens in Edit mode when the slide has content', async () => {
    openCardPopover()
    await screen.findByPlaceholderText(/What should change/)
    expect(screen.getByRole('button', { name: 'Edit this slide' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('switches to New slide mode when its tab is clicked — the reported bug', async () => {
    openCardPopover()
    await screen.findByPlaceholderText(/What should change/)

    fireEvent.click(screen.getByRole('button', { name: 'New slide after this' }))

    // The mode must actually flip: placeholder, buttons and the pressed tab.
    await screen.findByPlaceholderText(/What should this slide cover/)
    expect(screen.getByRole('button', { name: 'New slide after this' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Edit this slide' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suggest' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })

  it('generates a new slide from the New tab (Suggest with no topic)', async () => {
    const { onGenerate, onEdit } = openCardPopover()
    await screen.findByPlaceholderText(/What should change/)
    fireEvent.click(screen.getByRole('button', { name: 'New slide after this' }))
    await screen.findByRole('button', { name: 'Suggest' })
    fireEvent.click(screen.getByRole('button', { name: 'Suggest' }))
    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(null))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('applies an edit from the Edit tab', async () => {
    const { onEdit, onGenerate } = openCardPopover()
    const input = await screen.findByPlaceholderText(/What should change/)
    fireEvent.change(input, { target: { value: 'change 15% to 200%' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith('change 15% to 200%'))
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('the rail-header popover (no onEdit) has no tabs, only New', async () => {
    render(
      <SlideGenPopover onGenerate={vi.fn(async () => ({}))} trigger={<button type="button">rail</button>} />,
    )
    fireEvent.click(screen.getByText('rail'))
    await screen.findByPlaceholderText(/What should this slide cover/)
    expect(screen.queryByRole('button', { name: 'Edit this slide' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
  })
})
