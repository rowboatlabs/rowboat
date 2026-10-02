import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LocalFilePreview } from './local-file-preview'

vi.mock('@eigenpal/docx-editor-react', () => ({ DocxEditor: ({ mode }: { mode: string }) => <div data-testid="word-mode">{mode}</div> }))
const file = { url: 'app://file-preview/token', path: '/external/report.pdf', name: 'report.pdf', size: 20_000_000, mtimeMs: 123 }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
function setup(preview = file) {
  const invoke = vi.fn(async (channel: string) => channel === 'shell:previewFile' ? preview : { success: true })
  Object.assign(window, { ipc: { invoke } })
  return invoke
}
it('uses the same PDF viewer as Spaces without base64 reads or a 10 MB limit', async () => {
  const invoke = setup()
  const view = render(<LocalFilePreview path={file.path} onClose={vi.fn()} />)
  const frame = await screen.findByTitle('PDF preview')
  expect(frame).toHaveAttribute('src', file.url)
  fireEvent.load(frame)
  expect(screen.queryByText('Loading PDF…')).toBeNull()
  expect(invoke).not.toHaveBeenCalledWith('shell:readFileBase64', expect.anything())
  view.unmount()
  expect(invoke).toHaveBeenCalledWith('shell:releaseFilePreview', { url: file.url })
})
it('uses the shared Word viewer in read-only mode', async () => {
  setup({ ...file, name: 'report.docx', path: '/external/report.docx' })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }))
  render(<LocalFilePreview path="/external/report.docx" onClose={vi.fn()} />)
  expect(await screen.findByTestId('word-mode')).toHaveTextContent('viewing')
})
it('shows a missing-file error without launching the system app', async () => {
  const invoke = setup()
  invoke.mockRejectedValue(new Error('File not found'))
  render(<LocalFilePreview path="/missing.pdf" onClose={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('File not found')
  expect(invoke).not.toHaveBeenCalledWith('shell:openPath', expect.anything())
})
it('releases a preview that finishes loading after the column closes', async () => {
  let resolve!: (value: typeof file) => void
  const invoke = setup()
  invoke.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
  const view = render(<LocalFilePreview path={file.path} onClose={vi.fn()} />)
  view.unmount()
  resolve(file)
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('shell:releaseFilePreview', { url: file.url }))
})
