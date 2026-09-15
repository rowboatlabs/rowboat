import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CatalogTab } from './catalog'
vi.mock('@/components/model-selector', () => ({
  ModelSelector: () => <div>Default model</div>
}))
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <div>{children}</div>
}))
const invoke = vi.fn()
const installed = {
  folder: 'daily-app',
  agentSlugs: ['app--daily-app--refresh'],
  readiness: 'ready',
  manifest: { name: 'daily-app' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
beforeEach(() => {
  invoke.mockReset()
  Object.defineProperty(window, 'ipc', {
    configurable: true,
    value: { invoke }
  })
  invoke.mockImplementation(
    async (channel: string, args: { confirmed?: boolean }) => {
      if (channel === 'apps:list') return { apps: [], serverRunning: true }
      if (channel === 'apps:catalogIndex')
        return {
          records: [
            {
              name: 'daily-app',
              repo: 'author/daily-app',
              owner: 'author',
              description: 'Your day at a glance'
            }
          ],
          stale: false
        }
      if (channel === 'apps:catalogStars') return { stars: {}, starred: {} }
      if (channel === 'apps:catalogDetail')
        return {
          record: { repo: 'author/daily-app' },
          readme: 'A sample daily briefing'
        }
      if (channel === 'apps:install')
        return args.confirmed
          ? { status: 'installed', app: installed }
          : {
              status: 'preview',
              name: 'daily-app',
              version: '1.0.0',
              capabilities: [],
              agents: ['refresh.yaml']
            }
      if (channel === 'bg-task:get')
        return { success: true, task: { name: 'Refresh briefing' } }
      if (channel === 'bg-task:patch' || channel === 'bg-task:run')
        return { success: true }
      if (channel === 'apps:get') return { app: installed }
      throw new Error(channel)
    }
  )
})
afterEach(cleanup)
async function install() {
  fireEvent.click(await screen.findByRole('button', { name: 'View app' }))
  expect(await screen.findByText('A sample daily briefing')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Install' }))
  await screen.findByText('Bring your app to life')
}
describe('first app run', () => {
  it('shows loading while the catalog is pending', async () => {
    const pending = deferred<unknown>()
    invoke.mockImplementation((channel) =>
      channel === 'apps:catalogIndex'
        ? pending.promise
        : Promise.resolve({ apps: [] })
    )
    render(<CatalogTab onInstalled={vi.fn()} />)
    expect(screen.getByText('Loading the catalog…')).toBeInTheDocument()
    expect(
      screen.queryByText('No apps in the catalog yet.')
    ).not.toBeInTheDocument()
    await act(async () => pending.resolve({ records: [], stale: false }))
  })
  it('waits for completion, surfaces failure, and retries before opening', async () => {
    const run = deferred<{ success: boolean; error?: string }>()
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation((channel, args) =>
      channel === 'bg-task:run' ? run.promise : original(channel, args)
    )
    const onInstalled = vi.fn()
    render(<CatalogTab onInstalled={onInstalled} />)
    await install()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on & run now' }))
    await screen.findByText(/Fetching your data/)
    expect(onInstalled).not.toHaveBeenCalled()
    await act(async () =>
      run.resolve({ success: false, error: 'Reconnect your account' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reconnect your account'
    )
    expect(onInstalled).not.toHaveBeenCalled()
    invoke.mockImplementation(original)
    fireEvent.click(screen.getByRole('button', { name: 'Retry setup' }))
    await screen.findByText('Your app is ready to open')
    expect(onInstalled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open app' }))
    expect(onInstalled).toHaveBeenCalledWith('daily-app')
  })
  it('does not run an agent whose enable call returned success false', async () => {
    const original = invoke.getMockImplementation()!
    invoke.mockImplementation((channel, args) =>
      channel === 'bg-task:patch'
        ? Promise.resolve({ success: false, error: 'Model unavailable' })
        : original(channel, args)
    )
    render(<CatalogTab onInstalled={vi.fn()} />)
    await install()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on & run now' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Model unavailable')
    )
    expect(invoke.mock.calls.some((c) => c[0] === 'bg-task:run')).toBe(false)
  })
})
