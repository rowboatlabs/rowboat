import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NewAppDialog } from './new-app-dialog'
afterEach(cleanup)
it('turns a starter into one scaffold and a contextual build request', async () => {
  const invoke = vi.fn().mockResolvedValue({ app: {} })
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke }
  })
  const build = vi.fn()
  render(<NewAppDialog onClose={vi.fn()} onBuild={build} />)
  fireEvent.click(screen.getByRole('button', { name: 'Daily briefing' }))
  fireEvent.click(screen.getByRole('button', { name: 'Build app' }))
  await waitFor(() => expect(build).toHaveBeenCalledTimes(1))
  const folder = invoke.mock.calls[0][1].folder
  expect(invoke).toHaveBeenCalledWith(
    'apps:create',
    expect.objectContaining({ name: 'daily-briefing' })
  )
  expect(build).toHaveBeenCalledWith(
    expect.stringContaining('using the attached app as the starting point'),
    folder
  )
  expect(build.mock.calls[0][0]).toContain('no scheduled updates')
})
