import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Loader2, Lock, Search, Star, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  GENRES, LEVELS, LIBRARY, PROMPT_CATEGORIES, PROMPT_STORE_PATH,
  appLang, architectSystem, parseArchitect, planRank, readStore,
  type ArchitectAnswer, type PromptStore, type SavedPrompt,
} from '@/lib/prompt-library'

// The Prompts page (Baarali, 03/10/2026, validated mockup): the library of
// ready-made requests, the workshop that improves a request, and the
// person's own. « Use » opens a new chat with the text written in, for the
// person to fill the [brackets] and send.

type Tab = 'library' | 'workshop' | 'mine'

/** The store in the workspace: favourites and saved prompts. */
function usePromptStore() {
  const [store, setStore] = useState<PromptStore>({ favorites: [], saved: [] })
  useEffect(() => {
    let live = true
    void window.ipc.invoke('workspace:readFile', { path: PROMPT_STORE_PATH, encoding: 'utf8' }).then(
      (r) => live && setStore(readStore(r.data)),
      () => {},
    )
    return () => { live = false }
  }, [])
  const update = useCallback((next: (s: PromptStore) => PromptStore) => {
    setStore((current) => {
      const value = next(current)
      void window.ipc.invoke('workspace:writeFile', { path: PROMPT_STORE_PATH, data: JSON.stringify(value, null, 2), opts: { mkdirp: true } }).catch(() => {})
      return value
    })
  }, [])
  return [store, update] as const
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {})
}

function Library({ store, onUse, onImprove, onToggleFavorite }: {
  store: PromptStore
  onUse: (text: string) => void
  onImprove: (text: string) => void
  onToggleFavorite: (id: string) => void
}) {
  const lang = appLang()
  const [category, setCategory] = useState<string | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [query, setQuery] = useState('')
  const shown = LIBRARY.filter((p) => {
    if (favoritesOnly && !store.favorites.includes(p.id)) return false
    if (category && p.category !== category) return false
    const q = query.trim().toLowerCase()
    return !q || `${p.name[lang]} ${p.text[lang]}`.toLowerCase().includes(q)
  })
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a prompt…"
          className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => { setCategory(null); setFavoritesOnly(false) }}
          className={cn('rounded-full border px-3 py-1 text-[12.5px]', !category && !favoritesOnly ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}>
          All
        </button>
        {PROMPT_CATEGORIES.map((c) => (
          <button key={c.id} type="button" onClick={() => { setCategory(c.id); setFavoritesOnly(false) }} data-no-translate
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px]', category === c.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}>
            <c.icon className="size-3.5" />
            {c.name[lang]}
          </button>
        ))}
        <button type="button" onClick={() => { setFavoritesOnly(true); setCategory(null) }}
          className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px]', favoritesOnly ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}>
          <Star className="size-3.5" />
          Favorites
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No prompt here yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => {
            const cat = PROMPT_CATEGORIES.find((c) => c.id === p.category)
            const favorite = store.favorites.includes(p.id)
            return (
              <div key={p.id} className="flex flex-col gap-2 rounded-xl border bg-background p-4">
                <span className="text-[11.5px] font-medium text-primary" data-no-translate>{cat?.name[lang]}</span>
                <h4 className="text-[14.5px] font-semibold" data-no-translate>{p.name[lang]}</h4>
                <p className="line-clamp-4 text-[13px] text-muted-foreground" data-no-translate>{p.text[lang]}</p>
                <div className="mt-auto flex items-center gap-1.5 pt-1">
                  <Button size="sm" onClick={() => onUse(p.text[lang])}>Use</Button>
                  <Button size="sm" variant="ghost" onClick={() => onImprove(p.text[lang])}>Improve</Button>
                  <button type="button" onClick={() => onToggleFavorite(p.id)} aria-pressed={favorite}
                    aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
                    className="ml-auto inline-flex size-8 items-center justify-center rounded-md hover:bg-accent">
                    <Star className={cn('size-4', favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">What is in [brackets] is yours to fill in before sending.</p>
    </div>
  )
}

function Workshop({ seed, planId, onUse, onSave }: {
  seed: string
  planId: string | null
  onUse: (text: string) => void
  onSave: (text: string) => void
}) {
  const lang = appLang()
  const rank = planRank(planId)
  const [genre, setGenre] = useState(GENRES[0].id)
  const [level, setLevel] = useState(LEVELS[0].id)
  const [ask, setAsk] = useState(seed)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<ArchitectAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // A prompt sent here from the library replaces the request (adjust-during-render).
  const [seenSeed, setSeenSeed] = useState(seed)
  if (seed !== seenSeed) {
    setSeenSeed(seed)
    setAsk(seed)
    setAnswer(null)
  }

  const improve = async () => {
    const g = GENRES.find((x) => x.id === genre) ?? GENRES[0]
    const l = LEVELS.find((x) => x.id === level) ?? LEVELS[0]
    if (!ask.trim() || busy) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await window.ipc.invoke('llm:generate', { prompt: ask.trim(), system: architectSystem(g, l, lang) })
      if (res.error || !res.text) setError('The prompt could not be improved. Try again in a moment.')
      else setAnswer(parseArchitect(res.text))
    } catch {
      setError('The prompt could not be improved. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What you want to create</p>
          <div className="grid grid-cols-2 gap-1.5">
            {GENRES.map((g) => (
              <button key={g.id} type="button" onClick={() => setGenre(g.id)} aria-pressed={genre === g.id} data-no-translate
                className={cn('rounded-lg border p-2 text-left text-[12.5px] font-medium', genre === g.id ? 'border-primary bg-primary/10' : 'hover:bg-accent')}>
                {g.name[lang]}
                <span className="block text-[11px] font-normal text-muted-foreground">{g.hint[lang]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Level</p>
          <div className="grid grid-cols-2 gap-1.5">
            {LEVELS.map((l) => {
              const locked = rank < l.minRank
              return (
                <button key={l.id} type="button" disabled={locked} onClick={() => setLevel(l.id)} aria-pressed={level === l.id}
                  className={cn('rounded-lg border p-2 text-left text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50', level === l.id ? 'border-primary bg-primary/10' : 'hover:bg-accent')}>
                  <span data-no-translate>{l.name[lang]}</span>
                  <span className="block text-[11px] font-normal text-muted-foreground" data-no-translate>{l.hint[lang]}</span>
                  {locked && (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400">
                      <Lock className="size-3" />
                      With a bigger plan
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex min-h-[420px] flex-col rounded-xl border">
        <div className="flex-1 space-y-4 p-4">
          {!answer && !busy && !error && (
            <p className="text-sm text-muted-foreground">
              Describe what you want to get. Baarali turns it into a precise prompt, says why it works and suggests two other angles.
            </p>
          )}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Improving…</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {answer && !busy && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <h5 className="text-[13px] font-semibold">Improved prompt</h5>
                <div className="relative whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 pr-10 text-[13px] leading-relaxed" data-no-translate>
                  {answer.prompt}
                  <button type="button" onClick={() => copy(answer.prompt)} aria-label="Copy"
                    className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md hover:bg-accent">
                    <Copy className="size-3.5" />
                  </button>
                </div>
              </div>
              {answer.why.length > 0 && (
                <div className="space-y-1">
                  <h5 className="text-[13px] font-semibold">Why it works</h5>
                  <ul className="list-disc space-y-0.5 pl-5 text-[13px]" data-no-translate>{answer.why.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
              {answer.variants.length > 0 && (
                <div className="space-y-1">
                  <h5 className="text-[13px] font-semibold">Two variants</h5>
                  <ul className="list-disc space-y-0.5 pl-5 text-[13px]" data-no-translate>{answer.variants.map((v) => <li key={v}>{v}</li>)}</ul>
                </div>
              )}
              {answer.tip && <p className="text-[13px] text-muted-foreground" data-no-translate>{answer.tip}</p>}
            </div>
          )}
          {answer && !busy && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onUse(answer.prompt)}>Use in a chat</Button>
              <Button size="sm" variant="outline" disabled={saved} onClick={() => { onSave(answer.prompt); setSaved(true) }}>
                {saved ? 'Saved in My prompts' : 'Save in My prompts'}
              </Button>
            </div>
          )}
        </div>
        <div className="flex gap-2 border-t p-3">
          <textarea
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void improve() } }}
            rows={2}
            placeholder="Describe what you want to get…"
            className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <Button onClick={() => void improve()} disabled={!ask.trim() || busy} className="self-end">Improve</Button>
        </div>
      </div>
    </div>
  )
}

function Mine({ saved, onUse, onRemove }: { saved: SavedPrompt[]; onUse: (text: string) => void; onRemove: (id: string) => void }) {
  if (saved.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">What you save from the Workshop arrives here.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {saved.map((s) => (
        <div key={s.id} className="flex flex-col gap-2 rounded-xl border bg-background p-4">
          <h4 className="text-[14.5px] font-semibold" data-no-translate>{s.name}</h4>
          <p className="line-clamp-4 text-[13px] text-muted-foreground" data-no-translate>{s.text}</p>
          <div className="mt-auto flex items-center gap-1.5 pt-1">
            <Button size="sm" onClick={() => onUse(s.text)}>Use</Button>
            <button type="button" onClick={() => onRemove(s.id)} aria-label="Delete"
              className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive">
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function PromptsView({ onUse }: { onUse: (text: string) => void }) {
  const [tab, setTab] = useState<Tab>('library')
  // The plan opens the workshop's levels (control catalog.ts).
  const [planId, setPlanId] = useState<string | null>(null)
  useEffect(() => {
    void window.ipc.invoke('billing:getInfo', null).then((b) => setPlanId(b.subscriptionPlanId), () => {})
  }, [])
  const [seed, setSeed] = useState('')
  const [store, update] = usePromptStore()
  const tabs = useMemo(() => [
    { id: 'library' as const, label: 'Library' },
    { id: 'workshop' as const, label: 'Workshop' },
    { id: 'mine' as const, label: 'My prompts' },
  ], [])
  const save = (text: string) => update((s) => ({
    ...s,
    saved: [{ id: `p-${Date.now()}`, name: text.split(/[.:\n]/)[0].slice(0, 60), text, category: null, at: Date.now() }, ...s.saved],
  }))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-[1120px] shrink-0 px-[30px] pt-[34px] pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Prompts</h1>
            <p className="mt-1 text-[14px] text-muted-foreground">Ready-made requests, and a workshop to write your own.</p>
          </div>
          <div role="tablist" className="flex gap-1 rounded-lg border bg-muted/40 p-1">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium', tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1120px] px-[30px] pb-12">
          {tab === 'library' && (
            <Library
              store={store}
              onUse={onUse}
              onImprove={(text) => { setSeed(text); setTab('workshop') }}
              onToggleFavorite={(id) => update((s) => ({
                ...s,
                favorites: s.favorites.includes(id) ? s.favorites.filter((f) => f !== id) : [...s.favorites, id],
              }))}
            />
          )}
          {tab === 'workshop' && <Workshop seed={seed} planId={planId} onUse={onUse} onSave={save} />}
          {tab === 'mine' && <Mine saved={store.saved} onUse={onUse} onRemove={(id) => update((s) => ({ ...s, saved: s.saved.filter((x) => x.id !== id) }))} />}
        </div>
      </div>
    </div>
  )
}
