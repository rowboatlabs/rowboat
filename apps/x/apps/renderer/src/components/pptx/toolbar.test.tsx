import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorToolbar, type ToolbarProps } from './toolbar'

afterEach(cleanup)

function toolbarProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    canUndo: false,
    canRedo: false,
    onUndo: () => {},
    onRedo: () => {},
    zoomPercent: 100,
    isFitZoom: true,
    onZoomIn: () => {},
    onZoomOut: () => {},
    onZoomFit: () => {},
    format: { bold: false, italic: false, underline: false, sizePt: 20, colorHex: '000000' },
    formatDisabledReason: null,
    onInsert: () => {},
    shapeFill: null,
    shapeLine: null,
    onShapeFillChange: () => {},
    onShapeLineChange: () => {},
    font: 'Tahoma',
    deckFonts: ['Tahoma'],
    onFontChange: () => {},
    onToggleBold: () => {},
    onToggleItalic: () => {},
    onToggleUnderline: () => {},
    onFontSizeStep: () => {},
    onColorChange: () => {},
    align: 'l',
    onAlign: () => {},
    slideNumber: 1,
    slideCount: 3,
    ...overrides,
  }
}

describe('font picker', () => {
  it('opens into a PORTAL, outside the toolbar row that would clip it', () => {
    // The row is `overflow-x-auto`; per CSS that forces overflow-y from
    // `visible` to `auto`, so a menu positioned inside it was mounted with
    // aria-expanded=true and still invisible — clipped by the row's own
    // scrollport. It has to live outside that subtree.
    render(<EditorToolbar {...toolbarProps()} />)
    const trigger = screen.getByLabelText('Font')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('listbox')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.closest('.overflow-x-auto')).toBeNull()
  })

  it('never takes focus, so the text selection survives a pick', () => {
    // Every control is a plain button that cancels mousedown. Taking focus
    // would blur the contentEditable, commit the edit and end the session, so
    // the pick would land on the whole shape instead of the selected runs.
    const onFontChange = vi.fn()
    render(<EditorToolbar {...toolbarProps({ onFontChange })} />)
    const trigger = screen.getByLabelText('Font')
    // fireEvent returns false when the event was cancelled.
    expect(fireEvent.mouseDown(trigger), 'trigger cancels mousedown').toBe(false)

    fireEvent.click(trigger)
    const menu = screen.getByRole('listbox')
    const option = within(menu).getByRole('option', { name: /Georgia/ })
    expect(fireEvent.mouseDown(option), 'option cancels mousedown').toBe(false)

    fireEvent.click(option)
    expect(onFontChange).toHaveBeenCalledWith('Georgia')
    // Picking closes the menu.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('lists the deck fonts first, then the common ones without duplicates', () => {
    render(<EditorToolbar {...toolbarProps({ deckFonts: ['Tahoma', 'Poppins'] })} />)
    fireEvent.click(screen.getByLabelText('Font'))
    const names = within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(names.slice(0, 2)).toEqual(['Tahoma', 'Poppins'])
    // Tahoma came from the deck group, so the common group must not repeat it.
    expect(names.filter((n) => n === 'Tahoma')).toHaveLength(1)
    expect(names).toContain('Calibri')
  })

  it('closes on Escape and on an outside pointerdown', () => {
    render(<EditorToolbar {...toolbarProps()} />)
    const trigger = screen.getByLabelText('Font')

    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a pointerdown inside the portaled menu from closing it', () => {
    render(<EditorToolbar {...toolbarProps()} />)
    fireEvent.click(screen.getByLabelText('Font'))
    const menu = screen.getByRole('listbox')
    fireEvent.pointerDown(menu)
    expect(screen.queryByRole('listbox')).not.toBeNull()
  })

  it('is disabled, and shows no menu, when the selection cannot take formatting', () => {
    render(
      <EditorToolbar
        {...toolbarProps({ format: null, formatDisabledReason: 'Select a text box first' })}
      />,
    )
    const trigger = screen.getByLabelText('Font')
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('shape fill / outline', () => {
  it('is hidden entirely when the selection is not a restylable shape', () => {
    render(<EditorToolbar {...toolbarProps()} />)
    expect(screen.queryByLabelText('Shape fill')).toBeNull()
    expect(screen.queryByLabelText('Shape outline')).toBeNull()
  })

  it('shows both swatches for a shape and reports the picked colour as RRGGBB', () => {
    const onShapeFillChange = vi.fn()
    const onShapeLineChange = vi.fn()
    render(
      <EditorToolbar
        {...toolbarProps({
          shapeFill: '#ff0000',
          shapeLine: '#00ff00',
          onShapeFillChange,
          onShapeLineChange,
        })}
      />,
    )
    const fill = screen.getByLabelText('Shape fill') as HTMLInputElement
    const line = screen.getByLabelText('Shape outline') as HTMLInputElement
    expect(fill.value).toBe('#ff0000')
    expect(line.value).toBe('#00ff00')

    fireEvent.change(fill, { target: { value: '#336699' } })
    expect(onShapeFillChange).toHaveBeenCalledWith('336699')
    fireEvent.change(line, { target: { value: '#123456' } })
    expect(onShapeLineChange).toHaveBeenCalledWith('123456')
  })

  it('shows outline alone for a connector, which has no fill', () => {
    render(<EditorToolbar {...toolbarProps({ shapeFill: null, shapeLine: '#0000ff' })} />)
    expect(screen.queryByLabelText('Shape fill')).toBeNull()
    expect(screen.getByLabelText('Shape outline')).toBeInTheDocument()
  })
})

describe('insert menu', () => {
  it('portals its menu and reports the chosen kind', () => {
    const onInsert = vi.fn()
    render(<EditorToolbar {...toolbarProps({ onInsert })} />)
    const trigger = screen.getByLabelText('Insert')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.closest('.overflow-x-auto')).toBeNull()
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Text box',
      'Rectangle',
      'Rounded rectangle',
      'Ellipse',
      'Line',
      'Image\u2026',
    ])

    // Focus must stay in the editor, as with every other toolbar control.
    const item = within(menu).getByRole('menuitem', { name: 'Rounded rectangle' })
    expect(fireEvent.mouseDown(item)).toBe(false)
    fireEvent.click(item)
    expect(onInsert).toHaveBeenCalledWith('roundRect')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('stays available with no shape selected — insert is not a selection action', () => {
    render(<EditorToolbar {...toolbarProps({ format: null, formatDisabledReason: 'none' })} />)
    expect(screen.getByLabelText('Insert')).not.toBeDisabled()
  })
})
