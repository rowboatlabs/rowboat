import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileCardProvider } from '@/contexts/file-card-context'
import { SidebarSectionProvider } from '@/contexts/sidebar-context'
import { FilePathCard } from './file-path-card'

// A file card is how the assistant hands a file it just wrote to the user. A
// workspace file the app can show must land in the app's own view — an
// assistant-created deck opens in the slide editor, not Keynote — while
// anything the app can't show stays with the OS opener.

const ROOT = '/Users/test/rowboat'

let openedPaths: string[]
let shellOpened: string[]

function installIpc(opts?: { imageReadFails?: boolean }) {
  openedPaths = []
  shellOpened = []
  ;(window as unknown as { ipc: unknown }).ipc = {
    on: () => () => undefined,
    send: () => undefined,
    invoke: vi.fn(async (channel: string, args: unknown) => {
      if (channel === 'workspace:getRoot') return { root: ROOT }
      if (channel === 'shell:openPath') {
        shellOpened.push((args as { path: string }).path)
        return { success: true }
      }
      if (channel === 'shell:readFileBase64') {
        if (opts?.imageReadFails) throw new Error('unreadable')
        return { mimeType: 'image/png', data: '' }
      }
      throw new Error(`no handler: ${channel}`)
    }),
  }
}

/** The host surfaces (full-screen chat and the sidebar) both route in-app. */
function renderCard(filePath: string, opts?: { inApp?: boolean }) {
  const inApp = opts?.inApp ?? true
  return render(
    <SidebarSectionProvider>
      <FileCardProvider
        onOpenKnowledgeFile={(p) => openedPaths.push(`knowledge:${p}`)}
        onOpenFile={inApp ? (p) => openedPaths.push(p) : undefined}
      >
        <FilePathCard filePath={filePath} />
      </FileCardProvider>
    </SidebarSectionProvider>,
  )
}

/**
 * CardShell is the outermost element with role=button; the "Open" pill and the
 * audio play button sit inside it, so the card itself is always first in
 * document order.
 */
const clickCard = () => fireEvent.click(screen.getAllByRole('button')[0])

beforeEach(() => { installIpc() })
afterEach(() => { cleanup() })

describe('file card open routing', () => {
  it('opens a workspace deck in the app, not the OS', async () => {
    renderCard('presentations/Q3 review.pptx')
    clickCard()

    await waitFor(() => expect(openedPaths).toEqual(['presentations/Q3 review.pptx']))
    expect(shellOpened).toEqual([])
  })

  it('maps an absolute path under the workspace root to a relative one', async () => {
    renderCard(`${ROOT}/presentations/Q3 review.pptx`)
    clickCard()

    await waitFor(() => expect(openedPaths).toEqual(['presentations/Q3 review.pptx']))
    expect(shellOpened).toEqual([])
  })

  it('leaves a file outside the workspace to the OS opener', async () => {
    renderCard('/Users/test/Desktop/board.pptx')
    clickCard()

    await waitFor(() => expect(shellOpened).toEqual(['/Users/test/Desktop/board.pptx']))
    expect(openedPaths).toEqual([])
  })

  it('leaves a workspace file with no in-app viewer to the OS opener', async () => {
    renderCard('archives/data.zip')
    clickCard()

    await waitFor(() => expect(shellOpened).toEqual(['archives/data.zip']))
    expect(openedPaths).toEqual([])
  })

  it('falls back to the OS opener on a surface with no in-app route', async () => {
    renderCard('presentations/Q3 review.pptx', { inApp: false })
    clickCard()

    await waitFor(() => expect(shellOpened).toEqual(['presentations/Q3 review.pptx']))
    expect(openedPaths).toEqual([])
  })

  it('routes the other in-app types the same way', async () => {
    for (const path of ['docs/contract.docx', 'clips/demo.mp4', 'notes/plan.md']) {
      renderCard(path)
      clickCard()
      await waitFor(() => expect(openedPaths).toContain(path))
      cleanup()
    }
    expect(shellOpened).toEqual([])
  })

  // Image paths are the one in-app type that skips the card entirely: they
  // render as a bare ChatGPT-style picture, and clicking expands into the
  // lightbox instead of routing anywhere.
  it('shows an image inline and expands it on click instead of routing', async () => {
    renderCard('images/shot.png')

    // The picture only appears once its bytes arrive over IPC.
    const img = await screen.findByRole('button', { name: 'shot.png' })
    fireEvent.click(img)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(openedPaths).toEqual([])
    expect(shellOpened).toEqual([])
  })

  it('falls back to a routing card when the image bytes cannot be read', async () => {
    installIpc({ imageReadFails: true })
    renderCard('images/shot.png')

    // The fallback card appears only after the read rejects.
    const card = (await screen.findAllByRole('button'))[0]
    fireEvent.click(card)

    await waitFor(() => expect(openedPaths).toEqual(['images/shot.png']))
    expect(shellOpened).toEqual([])
  })

  it('routes an audio card in-app while keeping its inline player', async () => {
    renderCard('recordings/standup.m4a')

    // The icon slot is the play button; the card body is the open affordance.
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(1)

    clickCard()
    await waitFor(() => expect(openedPaths).toEqual(['recordings/standup.m4a']))
    expect(shellOpened).toEqual([])
  })

  it('still sends knowledge/ paths through the knowledge route', async () => {
    renderCard('knowledge/People/Sarah Chen.md')
    clickCard()

    await waitFor(() => expect(openedPaths).toEqual(['knowledge:knowledge/People/Sarah Chen.md']))
    expect(shellOpened).toEqual([])
  })

  it('keeps the card presentation unchanged', () => {
    renderCard('presentations/Q3 review.pptx')

    expect(screen.getByText('Q3 review')).toBeInTheDocument()
    expect(screen.getByText('Document · PPTX')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
  })
})
