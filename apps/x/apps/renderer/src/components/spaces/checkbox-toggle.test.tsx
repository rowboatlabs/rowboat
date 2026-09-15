import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { spaces } from '@x/shared'
import type { OrgWithSpaces } from '@/hooks/use-spaces'
import { RichMarkdownViewer } from '@/components/rich-markdown-viewer'
import { toast } from '@/lib/toast'
import { FileColumn } from './files-tab'

vi.mock('@/components/markdown-editor', () => ({ MarkdownEditor: () => null }))
vi.mock('./document-viewer', () => ({ SpaceDocumentViewer: () => null }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('react-tweet', () => ({ Tweet: () => null }))

const org = { id: 'org', address: 'spaces.example.com' } as OrgWithSpaces
const space = { id: 'space', name: 'Team' } as spaces.Space
const invoke = vi.fn()
const onChanged = vi.fn()
const original = '# Tasks\n\n- [ ] Same task\n  - [ ] Same task\n\n```md\n- [ ] Example only\n```\n\n- [ ] Last task'
let asset: spaces.ReadAssetResult

beforeEach(() => {
  vi.clearAllMocks()
  asset = { id: 'file', path: 'tasks.md', version: 3, content: original, recentHistory: [] }
  invoke.mockImplementation(async (channel, args) => {
    if (channel === 'spaces:readAsset') return { ...asset }
    if (channel === 'spaces:proposeChange') {
      asset = { ...asset, content: args.input.newContent, version: asset.version + 1 }
      return { outcome: 'applied', version: asset.version }
    }
    throw new Error(`Unexpected channel ${channel}`)
  })
  window.ipc = { ...window.ipc, invoke } as typeof window.ipc
})
afterEach(cleanup)

function file(refreshTick = 0) {
  return <FileColumn org={org} space={space} assetId="file" memberNames={new Map()}
    refreshTick={refreshTick} onChanged={onChanged} />
}

describe('Spaces Markdown checkboxes', () => {
  it('proposes the selected nested task against the current version, then can untick it', async () => {
    render(file())
    const nested = (await screen.findAllByRole('checkbox'))[1]
    fireEvent.click(nested)
    const checked = original.replace('  - [ ] Same task', '  - [x] Same task')
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', {
      orgId: 'org', spaceId: 'space',
      input: { assetId: 'file', baseVersion: 3, newContent: checked },
    }))
    await waitFor(() => expect(nested).toBeChecked())

    fireEvent.click(nested)
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', {
      orgId: 'org', spaceId: 'space',
      input: { assetId: 'file', baseVersion: 4, newContent: original },
    }))
    await waitFor(() => expect(nested).not.toBeChecked())
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('targets the current task after a remote edit changes positions and task order', async () => {
    const view = render(file())
    await screen.findByRole('checkbox', { name: 'Task item checkbox for Last task' })
    asset = { ...asset, version: 8, content: `Remote update\n\n- [ ] New task\n\n${original}` }
    view.rerender(file(1))
    await screen.findByRole('checkbox', { name: 'Task item checkbox for New task' })

    const checked = asset.content.replace('- [ ] Last task', '- [x] Last task')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Task item checkbox for Last task' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('spaces:proposeChange', {
      orgId: 'org', spaceId: 'space',
      input: { assetId: 'file', baseVersion: 8, newContent: checked },
    }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Task item checkbox for Last task' })).toBeChecked())
  })

  it('keeps the saved checkbox state when the service reports a conflict', async () => {
    invoke.mockImplementation(async (channel) => {
      if (channel === 'spaces:readAsset') return { ...asset }
      if (channel === 'spaces:proposeChange') return { outcome: 'conflict' }
      throw new Error(`Unexpected channel ${channel}`)
    })
    render(file())
    const checkbox = await screen.findByRole('checkbox', { name: 'Task item checkbox for Last task' })
    fireEvent.click(checkbox)
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('Someone changed this line'), 'error'))
    expect(checkbox).not.toBeChecked()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('keeps viewers without a save callback read-only', async () => {
    render(<RichMarkdownViewer content="- [ ] Read only" />)
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
    expect(invoke).not.toHaveBeenCalled()
  })
})
