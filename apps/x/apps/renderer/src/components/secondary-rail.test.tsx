import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecondaryRail } from './secondary-rail'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderRail(open: boolean) {
  const onTogglePin = vi.fn()
  render(
    <SecondaryRail open={open} onTogglePin={onTogglePin} widthStorageKey="test:railWidth">
      {({ togglePin }) => (
        <div>
          <button type="button" onClick={togglePin}>pin</button>
          <span>rail content</span>
        </div>
      )}
    </SecondaryRail>,
  )
  return { onTogglePin }
}

const aside = () => screen.getByText('rail content').closest('aside') as HTMLElement
const drawer = () => screen.getByText('rail content').closest('[inert]')

describe('SecondaryRail', () => {
  it('docked: renders interactive content with a width-resize handle', () => {
    renderRail(true)
    expect(drawer()).toBeNull()
    expect(screen.getByTitle('Drag to resize')).toBeTruthy()
  })

  it('docked: the context togglePin reports to the parent', () => {
    const { onTogglePin } = renderRail(true)
    fireEvent.click(screen.getByText('pin'))
    expect(onTogglePin).toHaveBeenCalledTimes(1)
  })

  it('collapsed: content waits inert in the drawer, no resize handle', () => {
    renderRail(false)
    expect(drawer()).toBeTruthy()
    expect(screen.queryByTitle('Drag to resize')).toBeNull()
  })

  it('collapsed: hovering peeks the drawer open; leaving slides it back', () => {
    vi.useFakeTimers()
    renderRail(false)
    fireEvent.mouseEnter(aside())
    act(() => { vi.advanceTimersByTime(150) })
    expect(drawer()).toBeNull()
    fireEvent.mouseLeave(aside())
    act(() => { vi.advanceTimersByTime(250) })
    expect(drawer()).toBeTruthy()
  })

  it('peeked: togglePin is the lock — it reaches the parent', () => {
    vi.useFakeTimers()
    const { onTogglePin } = renderRail(false)
    fireEvent.mouseEnter(aside())
    act(() => { vi.advanceTimersByTime(150) })
    fireEvent.click(screen.getByText('pin'))
    expect(onTogglePin).toHaveBeenCalledTimes(1)
  })
})
