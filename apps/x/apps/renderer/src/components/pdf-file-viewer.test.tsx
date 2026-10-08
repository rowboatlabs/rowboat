import { useLayoutEffect } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PdfFileViewer } from './pdf-file-viewer'

afterEach(cleanup)

it('keeps a PDF ready when it loads before passive effects run', () => {
  function ImmediatelyLoadedPdf() {
    useLayoutEffect(() => {
      screen.getByTitle('PDF preview').dispatchEvent(new Event('load'))
    }, [])
    return <PdfFileViewer path="report.pdf" />
  }
  render(<ImmediatelyLoadedPdf />)
  expect(screen.queryByText('Loading PDF…')).not.toBeInTheDocument()
})

it('starts loading again when switching from a ready PDF to another path', () => {
  const view = render(<PdfFileViewer path="first.pdf" />)
  const first = screen.getByTitle('PDF preview')
  fireEvent.load(first)
  expect(screen.queryByText('Loading PDF…')).not.toBeInTheDocument()
  view.rerender(<PdfFileViewer path="second.pdf" />)
  const second = screen.getByTitle('PDF preview')
  expect(second).not.toBe(first)
  expect(second).toHaveAttribute('src', 'app://workspace/second.pdf')
  fireEvent.load(first)
  expect(screen.getByText('Loading PDF…')).toBeInTheDocument()
  fireEvent.load(second)
  expect(screen.queryByText('Loading PDF…')).not.toBeInTheDocument()
})
