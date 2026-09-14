import { describe, expect, it, vi } from 'vitest'
import { buildBrowserContextMenu } from '../../../main/src/browser/context-menu'

type Contents = Parameters<typeof buildBrowserContextMenu>[0]
type Params = Parameters<typeof buildBrowserContextMenu>[1]

function setup(overrides: Partial<Params> = {}) {
  const contents = {
    isDestroyed: vi.fn(() => false), focus: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), pasteAndMatchStyle: vi.fn(), selectAll: vi.fn(),
    reload: vi.fn(), copyImageAt: vi.fn(), downloadURL: vi.fn(),
    navigationHistory: {
      canGoBack: vi.fn(() => true), canGoForward: vi.fn(() => false), goBack: vi.fn(), goForward: vi.fn(),
    },
  }
  const actions = { openTab: vi.fn(), copyText: vi.fn() }
  const params = {
    x: 12, y: 34, isEditable: false, selectionText: '', linkURL: '', srcURL: '',
    mediaType: 'none', pageURL: 'https://example.com/', hasImageContents: false,
    editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: true, canPaste: true, canSelectAll: true },
    ...overrides,
  } as Params
  const menu = buildBrowserContextMenu(contents as unknown as Contents, params, actions)
  const item = (label: string) => {
    const found = menu.find(entry => entry.label === label)
    if (!found) throw new Error(`Missing menu item: ${label}`)
    return found
  }
  const click = (label: string) => (item(label).click as () => void)()
  return { contents, actions, menu, item, click }
}

describe('embedded browser context menu', () => {
  it('uses the originating page history and rechecks it when clicked', () => {
    const { contents, item, click } = setup()
    expect(item('Back').enabled).toBe(true)
    expect(item('Forward').enabled).toBe(false)
    contents.navigationHistory.canGoBack.mockReturnValue(false)
    click('Back')
    expect(contents.navigationHistory.goBack).not.toHaveBeenCalled()
    click('Reload')
    expect(contents.reload).toHaveBeenCalledOnce()
  })

  it('respects editing capabilities and pastes into the original contents', () => {
    const { contents, item, click, menu } = setup({ isEditable: true })
    expect(item('Cut').enabled).toBe(false)
    expect(item('Undo').enabled).toBe(false)
    expect(item('Paste').enabled).toBe(true)
    expect(menu.some(entry => entry.label === 'Back')).toBe(false)
    click('Paste as plain text')
    expect(contents.focus).toHaveBeenCalledOnce()
    expect(contents.pasteAndMatchStyle).toHaveBeenCalledOnce()
  })

  it('copies the selected text captured before the menu takes focus', () => {
    const { click, actions } = setup({ selectionText: 'Selected words' })
    click('Copy')
    expect(actions.copyText).toHaveBeenCalledWith('Selected words')
  })

  it('opens web links in an embedded tab and copies their full address', () => {
    const url = 'https://example.com/path?q=hello#section'
    const { click, actions } = setup({ linkURL: url })
    click('Open link in new tab')
    click('Copy link address')
    expect(actions.openTab).toHaveBeenCalledWith(url)
    expect(actions.copyText).toHaveBeenCalledWith(url)
  })

  it.each(['javascript:alert(1)', 'file:///secret', 'data:text/html,hello', 'mailto:person@example.com'])(
    'does not turn a %s link into an embedded navigation', (linkURL) => {
      const { item, click, actions } = setup({ linkURL })
      expect(item('Open link in new tab').enabled).toBe(false)
      click('Open link in new tab')
      expect(actions.openTab).not.toHaveBeenCalled()
    },
  )

  it('offers both link and image actions for linked images', () => {
    const { item, click, contents, actions } = setup({
      linkURL: 'https://example.com/article', mediaType: 'image',
      srcURL: 'https://example.com/image.png', hasImageContents: true,
    })
    expect(item('Open link in new tab').enabled).toBe(true)
    expect(item('Copy image').enabled).toBe(true)
    click('Copy image')
    expect(contents.copyImageAt).toHaveBeenCalledWith(12, 34)
    click('Open image in new tab')
    expect(actions.openTab).toHaveBeenCalledWith('https://example.com/image.png')
  })

  it('disables copying an unloaded image and does not call destroyed contents', () => {
    const { item, click, contents } = setup({ mediaType: 'image' })
    expect(item('Copy image').enabled).toBe(false)
    contents.isDestroyed.mockReturnValue(true)
    click('Copy image')
    expect(contents.copyImageAt).not.toHaveBeenCalled()
    expect(contents.focus).not.toHaveBeenCalled()
  })

  it.each(['https://example.com/photo.gif', 'blob:https://example.com/image-id', 'data:image/png;base64,aGVsbG8='])(
    'saves %s through the originating browser contents', (srcURL) => {
      const { item, click, contents } = setup({ mediaType: 'image', srcURL })
      expect(item('Save image as…').enabled).toBe(true)
      click('Save image as…')
      expect(contents.downloadURL).toHaveBeenCalledWith(srcURL)
    },
  )

  it.each(['', 'javascript:alert(1)', 'file:///secret', 'data:text/html,hello'])(
    'does not download an unsupported image address: %s', (srcURL) => {
      const { item, click, contents } = setup({ mediaType: 'image', srcURL })
      expect(item('Save image as…').enabled).toBe(false)
      click('Save image as…')
      expect(contents.downloadURL).not.toHaveBeenCalled()
    },
  )

  it('does not start a download after the originating tab is destroyed', () => {
    const { click, contents } = setup({ mediaType: 'image', srcURL: 'https://example.com/image.png' })
    contents.isDestroyed.mockReturnValue(true)
    click('Save image as…')
    expect(contents.downloadURL).not.toHaveBeenCalled()
  })
})
