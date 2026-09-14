import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatMessageAttachments } from './chat-message-attachments'

const image = (filename: string) => ({ path: `/tmp/${filename}`, filename, mimeType: 'image/png', thumbnailUrl: `data:image/png;base64,${filename}` })
afterEach(cleanup)

describe('message image carousel', () => {
  it('opens the clicked image, navigates only message images, and resets zoom', () => {
    render(<>
      <ChatMessageAttachments attachments={[
        image('first.png'),
        { path: '/tmp/doc.pdf', filename: 'doc.pdf', mimeType: 'application/pdf' },
        { ...image('frame.png'), isVideoFrame: true },
        image('second.png'),
        image('third.png'),
      ]} />
      <ChatMessageAttachments attachments={[image('other.png')]} />
    </>)
    fireEvent.click(screen.getByRole('button', { name: 'Preview second.png' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('img', { name: 'second.png' })).toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 of 3')
    fireEvent.click(within(dialog).getByRole('img'))
    expect(within(dialog).getByRole('img').style.transform).toContain('scale(2.5)')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next image' }))
    expect(within(dialog).getByRole('img', { name: 'third.png' }).style.transform).toContain('scale(1)')
    expect(within(dialog).getByRole('button', { name: 'Next image' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(within(dialog).getByRole('status')).toHaveTextContent('3 of 3')
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous image' }))
    expect(within(dialog).getByRole('img', { name: 'first.png' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Previous image' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview second.png' }))
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('2 of 3')
  })

  it('omits navigation for a single image and closes with the close button', () => {
    render(<ChatMessageAttachments attachments={[image('only.png')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview only.png' }))
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close image preview' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
