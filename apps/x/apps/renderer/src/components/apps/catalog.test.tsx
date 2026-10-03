import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CatalogTab } from './catalog'
import { FICHES, accessOf } from './fiches'

// The catalog cards (Baarali, 02/10/2026): a plain name, what the app is for
// and what it reaches; the apps without a fiche wait behind a link, and a
// search finds every one.

const record = (name: string, owner: string, description: string) =>
  ({ schemaVersion: 1 as const, name, owner, repo: `${owner}/${name}`, description, createdAt: '2026-09-01T00:00:00Z' })

const RECORDS = [
  record('finance-tracker', 'yejianqin61-cell', 'Track expenses, income, manage categories.'),
  record('news-aggregator', 'prakhar1605', 'Top stories from Hacker News and Reddit'),
  record('hello-test', 'prakhar1605', 'A test app'),
]

let calls: { channel: string; args: unknown }[] = []

afterEach(cleanup)

beforeEach(() => {
  calls = []
  ;(window as unknown as { ipc: unknown }).ipc = {
    invoke: async (channel: string, args: unknown) => {
      calls.push({ channel, args })
      if (channel === 'apps:catalogIndex') return { records: RECORDS, stale: false }
      if (channel === 'apps:catalogSearch') return { records: RECORDS.filter((r) => r.name.includes(String((args as { query: string }).query))), stale: false }
      if (channel === 'apps:catalogStars') return { stars: {}, starred: {} }
      if (channel === 'apps:list') return { apps: [] }
      if (channel === 'apps:install') return { status: 'preview', name: 'news-aggregator', version: '0.1.0', description: 'Top stories', capabilities: ['reddit'], agents: [], updateSource: 'github' }
      return null
    },
    on: () => () => {},
  }
})

describe('CatalogTab', () => {
  it('shows the apps with a fiche by their plain name, what they reach, not their package name', async () => {
    render(<CatalogTab onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('Money tracker')).toBeTruthy())
    expect(screen.getByText('News')).toBeTruthy()
    expect(screen.queryByText('finance-tracker')).toBeNull()
    expect(screen.getByText('Your Reddit account')).toBeTruthy()
    expect(screen.getAllByText('No access to your accounts').length).toBeGreaterThan(0)
    // The test app waits behind the link.
    expect(screen.queryByText('hello-test')).toBeNull()
    fireEvent.click(screen.getByText('Show 1 more apps, not translated yet'))
    expect(screen.getByText('hello-test')).toBeTruthy()
  })

  it('sorts by shelf', async () => {
    render(<CatalogTab onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('Money tracker')).toBeTruthy())
    fireEvent.click(screen.getByText('Keeping watch'))
    expect(screen.queryByText('Money tracker')).toBeNull()
    expect(screen.getByText('News')).toBeTruthy()
  })

  it('finds an app without a fiche by searching', async () => {
    render(<CatalogTab onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('Money tracker')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('Search the catalog…'), { target: { value: 'hello' } })
    await waitFor(() => expect(screen.getByText('hello-test')).toBeTruthy())
  })

  it('says in plain words what the app will be able to do before installing', async () => {
    render(<CatalogTab onInstalled={() => {}} />)
    await waitFor(() => expect(screen.getByText('News')).toBeTruthy())
    fireEvent.click(screen.getAllByText('Install')[1])
    await waitFor(() => expect(screen.getByText('Install the app “News”?')).toBeTruthy())
    expect(screen.getByText('Read and act on your Reddit account')).toBeTruthy()
  })
})

describe('accessOf', () => {
  it('says what an app reaches, or that it reaches nothing', () => {
    expect(accessOf([], 0)).toEqual([{ label: 'No access to your accounts', tone: 'plain' }])
    expect(accessOf(['llm', 'gmail'], 2).map((a) => a.label)).toEqual(['Uses your AI', 'Your Gmail account', '2 agents included'])
  })

  it('has a fiche for apps that exist under that name', () => {
    for (const [name, fiche] of Object.entries(FICHES)) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(fiche.summary.length).toBeGreaterThan(20)
    }
  })
})
