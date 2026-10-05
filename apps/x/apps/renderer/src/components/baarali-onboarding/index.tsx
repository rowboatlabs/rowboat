import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, Inbox, Loader2, Lock, MessageCircle, Send, Sheet, Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { MobileChannelsSettings } from '@/components/settings/mobile-channels-settings'
import { GitHubIcon, GmailIcon, OutlookIcon, SlackIcon } from '@/components/onboarding/provider-icons'
import { Duo } from './duo'
import {
  clearSaved, ideasFor, loadSaved, mergeProfile, profileBlock, PROFILE_FILE, ROLES, SECTORS,
  spaceProgress, storeSaved, type Profile, type Saved, type Step,
} from './model'

// BAARALI(04/10/2026): Baarali's onboarding (model.ts says why it keeps its
// place across reloads). It replaces the upstream's in App.tsx only; the
// upstream's files stay as they are.

interface BaaraliOnboardingProps {
  open: boolean
  onComplete: (opts?: { prompt?: string }) => void
}

const STEPS = ['Welcome', 'Your space', 'You', 'Your tools', 'All set']

/** For text put in a field, which the French layer does not see (desktop i18n/index.ts). */
const say = (text: string) => (window as { __baaraliText?: (t: string) => string }).__baaraliText?.(text) ?? text

function Stepper({ current }: { current: Step }) {
  return (
    <ol className="flex items-start justify-center" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < current
        const active = i === current
        const marker: 'step' | undefined = active ? 'step' : undefined
        return (
          <li key={label} className="flex items-start" aria-current={marker}>
            {i > 0 && <div className={cn('mt-[15px] h-0.5 w-6', i <= current ? 'bg-primary' : 'bg-border')} aria-hidden="true" />}
            <div className="flex w-[88px] flex-col items-center gap-2">
              <div className={cn('flex size-8 items-center justify-center rounded-full text-xs font-semibold', done || active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {done ? <Check className="size-4" /> : i + 1}
              </div>
              <span className={cn('whitespace-nowrap text-xs', active ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Heading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      {children && <p className="text-base leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  )
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'h-9 rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

// ── 1. Welcome ────────────────────────────────────────────────────────────

function WelcomeStep({ signedIn, connecting, onSignIn, onContinue }: { signedIn: boolean; connecting: boolean; onSignIn: (returning: boolean) => void; onContinue: () => void }) {
  const promises = [
    { icon: Inbox, title: 'Your emails and calendar', text: 'Baarali sorts what matters and drafts your replies.' },
    { icon: Hand, title: 'The work you hand over', text: 'A reminder, a quote, some research: Baarali takes care of it, even while you are away.' },
    { icon: Lock, title: 'A space of your own', text: 'Your work is kept in your private, encrypted space, on all your devices.' },
  ]
  return (
    <div className="flex flex-col gap-6">
      <Duo first="Hello 👋" second="We were waiting for you" motion="bob" />
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Welcome to Baarali</h2>
        <p className="max-w-md text-base leading-relaxed text-muted-foreground">Your work assistant. It handles your emails, prepares your documents and does the tasks you hand over.</p>
      </div>
      <ul className="flex flex-col gap-4 rounded-xl bg-muted/40 p-5">
        {promises.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div>
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{title}</span>
              <span className="text-sm leading-snug text-muted-foreground">{text}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2.5">
        {signedIn ? (
          <Button size="lg" className="h-12 text-base" onClick={onContinue}>Continue</Button>
        ) : (
          <>
            <Button size="lg" className="h-12 text-base" disabled={connecting} onClick={() => onSignIn(false)}>
              {connecting ? <Loader2 className="size-4 animate-spin" /> : 'Create my account'}
            </Button>
            <Button size="lg" variant="outline" className="h-12 text-base" disabled={connecting} onClick={() => onSignIn(true)}>I already have an account</Button>
          </>
        )}
        <p role="status" className="text-center text-xs text-muted-foreground">
          {connecting ? 'Finish signing in in your browser, then come back here.' : 'Free to start. Sign-in opens in your browser.'}
        </p>
      </div>
    </div>
  )
}

// ── 2. Your space ─────────────────────────────────────────────────────────

type TaskState = 'done' | 'now' | 'todo'

function Task({ state, label }: { state: TaskState; label: string }) {
  return (
    <li className="flex items-center gap-3.5">
      {state === 'done' ? (
        <span className="flex size-6 items-center justify-center rounded-full bg-[var(--rowboat-success)] text-white"><Check className="size-3.5" /></span>
      ) : state === 'now' ? (
        <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <span className="size-6 rounded-full border-2 border-border" aria-hidden="true" />
      )}
      <span className={cn('text-sm', state === 'todo' ? 'text-muted-foreground' : 'text-foreground', state === 'now' && 'font-semibold')}>{label}</span>
    </li>
  )
}

function SpaceStep({ since, joined, returning, onContinue }: { since: number | null; joined: boolean; returning: boolean; onContinue: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (joined) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [joined])
  const progress = spaceProgress(since, now, joined)
  const slow = !joined && since !== null && now - since > 150_000
  const motion: 'hop' | 'bob' = joined ? 'hop' : 'bob'
  const preparing: TaskState = joined ? 'done' : 'now'
  const connectingApp: TaskState = joined ? 'done' : 'todo'
  return (
    <div className="flex flex-col gap-6">
      <Duo first={joined ? 'It is ready!' : 'Preparing your space…'} second={joined ? 'Off we go' : null} motion={motion} />
      <Heading title={joined ? 'Your space is ready' : 'Your space is being prepared'}>
        {returning ? 'Baarali is opening your space and everything you left in it.' : 'Baarali is creating your private space in the cloud. It takes about a minute, the first time only.'}
      </Heading>
      <div className="flex flex-col gap-4 rounded-xl bg-muted/40 p-5">
        <ul className="flex flex-col gap-4">
          <Task state="done" label="Account verified" />
          <Task state={preparing} label={returning ? 'Opening your space' : 'Creating and starting your space'} />
          <Task state={connectingApp} label="Connecting this app" />
        </ul>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {joined
          ? 'Everything is connected.'
          : slow
            ? 'This is taking longer than usual. You can keep going: the app connects as soon as your space answers.'
            : 'No need to wait: get to know each other meanwhile, the app connects by itself.'}
      </p>
      {!returning && (
        <Button size="lg" className="h-12 text-base" onClick={onContinue}>{joined ? 'Continue' : 'Continue while it gets ready'}</Button>
      )}
    </div>
  )
}

// ── 3. You ────────────────────────────────────────────────────────────────

function AboutStep({ profile, lang, onChange, onLang, onContinue, onSkip }: {
  profile: Profile; lang: string; onChange: (p: Profile) => void; onLang: (lang: 'fr' | 'en') => void; onContinue: () => void; onSkip: () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <Heading title="Let’s get to know each other">Baarali adapts to you: its answers, its suggestions and its ideas for tasks.</Heading>
      <div className="flex flex-col gap-2">
        <label htmlFor="baarali-onboarding-name" className="text-sm font-semibold">Your first name</label>
        <input
          id="baarali-onboarding-name"
          value={profile.name}
          onChange={(e) => onChange({ ...profile, name: e.target.value.slice(0, 60) })}
          autoComplete="given-name"
          className="h-11 rounded-lg border border-input bg-background px-3.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-sm font-semibold">Language of the app and of Baarali</legend>
        <div className="flex flex-wrap gap-2">
          <Chip label="Français" selected={lang === 'fr'} onClick={() => onLang('fr')} />
          <Chip label="English" selected={lang !== 'fr'} onClick={() => onLang('en')} />
        </div>
        <p className="text-xs text-muted-foreground">You can change it at any time in Settings.</p>
      </fieldset>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-sm font-semibold">Your activity</legend>
        <div className="flex flex-wrap gap-2">
          {SECTORS.map((s) => <Chip key={s} label={s} selected={profile.sector === s} onClick={() => onChange({ ...profile, sector: profile.sector === s ? null : s })} />)}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2.5 text-sm font-semibold">You are</legend>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => <Chip key={r} label={r} selected={profile.role === r} onClick={() => onChange({ ...profile, role: profile.role === r ? null : r })} />)}
        </div>
      </fieldset>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onSkip}>Skip</Button>
        <Button size="lg" className="h-12 px-7 text-base" onClick={onContinue}>Continue</Button>
      </div>
    </div>
  )
}

// ── 4. Your tools ─────────────────────────────────────────────────────────

type ToolState = 'connected' | 'connecting' | 'idle' | 'soon' | 'blocked' | 'included'

function ToolRow({ icon, name, text, state, onConnect, blockedReason }: { icon: React.ReactNode; name: string; text: string; state: ToolState; onConnect?: () => void; blockedReason?: string }) {
  return (
    <li className="flex items-center gap-3.5 rounded-xl bg-muted/40 px-4 py-3.5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background">{icon}</div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs leading-snug text-muted-foreground">{state === 'blocked' && blockedReason ? blockedReason : text}</span>
      </div>
      {state === 'connected' ? (
        <span role="status" className="flex items-center gap-1.5 text-sm font-semibold text-[var(--rowboat-success)]"><Check className="size-4" />Connected</span>
      ) : state === 'included' ? null : state === 'soon' ? (
        <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">Soon</span>
      ) : (
        <Button variant="outline" size="sm" disabled={state !== 'idle'} onClick={onConnect} aria-label={`Connect ${name}`}>
          {state === 'connecting' ? <Loader2 className="size-4 animate-spin" /> : 'Connect'}
        </Button>
      )}
    </li>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  )
}

function ToolsStep({ onContinue, onLater }: { onContinue: () => void; onLater: () => void }) {
  const [providers, setProviders] = useState<string[]>([])
  const [connected, setConnected] = useState<Record<string, boolean>>({})
  const [connecting, setConnecting] = useState<string | null>(null)
  const [phoneOpen, setPhoneOpen] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all([
      window.ipc.invoke('oauth:list-providers', null).catch(() => ({ providers: [] as string[] })),
      window.ipc.invoke('oauth:getState', null).catch(() => null),
    ]).then(([list, state]) => {
      if (!live) return
      setProviders(list.providers ?? [])
      const config = (state?.config ?? {}) as Record<string, { connected?: boolean } | undefined>
      setConnected({ google: !!config.google?.connected, microsoft: !!config.microsoft?.connected })
    })
    return () => { live = false }
  }, [])
  useEffect(() => window.ipc.on('oauth:didConnect', (event) => {
    if (event.provider !== 'google' && event.provider !== 'microsoft') return
    setConnecting(null)
    if (event.success) setConnected((prev) => ({ ...prev, [event.provider]: true }))
  }), [])

  const connect = async (provider: 'google' | 'microsoft') => {
    setConnecting(provider)
    const result = await window.ipc.invoke('oauth:connect', { provider }).catch(() => ({ success: false }))
    if (!result.success) setConnecting(null)
  }
  const sheets: ToolState = connected.google ? 'connected' : 'included'
  const stateOf = (provider: 'google' | 'microsoft', other: 'google' | 'microsoft'): ToolState =>
    connected[provider] ? 'connected' : connecting === provider ? 'connecting' : connected[other] ? 'blocked' : connecting ? 'blocked' : 'idle'

  return (
    <div className="flex flex-col gap-6">
      <Heading title="Connect your tools">The more Baarali sees, the more it helps. It prepares, you approve. Everything here is optional.</Heading>
      <Group title="Messaging: talk to Baarali from your phone">
        <ToolRow icon={<MessageCircle className="size-5 text-[#25D366]" />} name="WhatsApp" text="Scan a code with your phone" state="idle" onConnect={() => setPhoneOpen(true)} />
        <ToolRow icon={<Send className="size-5 text-[#229ED9]" />} name="Telegram" text="Chat with Baarali like with a contact" state="idle" onConnect={() => setPhoneOpen(true)} />
      </Group>
      {phoneOpen && (
        <div className="rounded-xl border p-4">
          <MobileChannelsSettings dialogOpen />
        </div>
      )}
      <Group title="Email and calendar">
        {providers.includes('google') && (
          <ToolRow icon={<GmailIcon className="size-5" />} name="Gmail and Google Calendar" text="A Google account" state={stateOf('google', 'microsoft')} onConnect={() => void connect('google')} blockedReason="Disconnect Outlook first, in Settings › Connections." />
        )}
        {providers.includes('microsoft') && (
          <ToolRow icon={<OutlookIcon className="size-5" />} name="Outlook and calendar" text="Microsoft 365 or Outlook.com" state={stateOf('microsoft', 'google')} onConnect={() => void connect('microsoft')} blockedReason="Disconnect Google first, in Settings › Connections." />
        )}
      </Group>
      <Group title="Documents and work">
        <ToolRow
          icon={<Sheet className="size-5 text-[#0F9D58]" />}
          name="Google Sheets and Docs"
          text={connected.google ? 'Included with your Google account: the files you open with Baarali' : 'Comes with your Google account'}
          state={sheets}
        />
        <ToolRow icon={<span className="text-sm font-bold">N</span>} name="Notion" text="Your pages and databases" state="soon" />
        <ToolRow icon={<SlackIcon className="size-5" />} name="Slack" text="Your team’s messages" state="soon" />
        <ToolRow icon={<GitHubIcon className="size-5" />} name="GitHub" text="Your repositories and issues" state="soon" />
      </Group>
      <p className="text-xs text-muted-foreground">You can add or remove them at any time in Settings › Connections.</p>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onLater}>Later</Button>
        <Button size="lg" className="h-12 px-7 text-base" onClick={onContinue}>Continue</Button>
      </div>
    </div>
  )
}

// ── 5. All set ────────────────────────────────────────────────────────────

function DoneStep({ profile, onFinish, finishing }: { profile: Profile; onFinish: (prompt?: string) => void; finishing: boolean }) {
  const name = profile.name.trim()
  return (
    <div className="flex flex-col gap-6">
      <Duo first="It is ready!" second={name ? `Over to you, ${name}` : 'Over to you'} motion="hop" />
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">{name ? `All set, ${name}` : 'All set'}</h2>
        <p className="max-w-md text-base leading-relaxed text-muted-foreground">To start, try one of these requests. You can also write your own.</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {ideasFor(profile.sector).map((idea) => (
          <li key={idea.title}>
            <button
              type="button"
              disabled={finishing}
              onClick={() => onFinish(say(idea.prompt))}
              className="flex w-full items-center gap-3.5 rounded-xl border bg-muted/30 px-5 py-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold">{idea.title}</span>
                <span className="text-xs text-muted-foreground">{idea.detail}</span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      <Button size="lg" className="h-12 text-base" disabled={finishing} onClick={() => onFinish()}>
        {finishing ? <Loader2 className="size-4 animate-spin" /> : 'Open Baarali'}
      </Button>
    </div>
  )
}

// ── The dialog ────────────────────────────────────────────────────────────

export function BaaraliOnboarding({ open, onComplete }: BaaraliOnboardingProps) {
  const [saved, setSaved] = useState<Saved>(() => loadSaved())
  const [signedIn, setSignedIn] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [joined, setJoined] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const lang = typeof document !== 'undefined' && document.documentElement.lang === 'fr' ? 'fr' : 'en'

  const update = useCallback((next: Partial<Saved>) => {
    setSaved((prev) => {
      const merged = { ...prev, ...next }
      storeSaved(merged)
      return merged
    })
  }, [])

  // Signed in to Baarali? Answered by this app, or by the instance once joined.
  useEffect(() => {
    if (!open) return
    void window.ipc.invoke('oauth:getState', null)
      .then((r) => setSignedIn(!!r.config?.rowboat?.connected))
      .catch(() => undefined)
    return window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider !== 'rowboat') return
      setConnecting(false)
      if (!event.success) return
      setSignedIn(true)
      setSaved((prev) => {
        if (prev.step !== 0) return prev
        const next = { ...prev, step: 1 as Step, spaceSince: Date.now() }
        storeSaved(next)
        return next
      })
    })
  }, [open])

  // Joined to the instance: the app's server is the remote one.
  useEffect(() => {
    if (!open) return
    let live = true
    const check = () => void window.ipc.invoke('server:getConnection', null)
      .then((r) => { if (live) setJoined(r.mode === 'remote') })
      .catch(() => undefined)
    check()
    const timer = window.setInterval(check, 2000)
    return () => { live = false; window.clearInterval(timer) }
  }, [open])

  const finish = useCallback(async (prompt?: string) => {
    setFinishing(true)
    const block = profileBlock(saved.profile, lang)
    if (block) {
      try {
        const existing = await window.ipc.invoke('workspace:readFile', { path: PROFILE_FILE, encoding: 'utf8' })
          .then((r) => r.data).catch(() => '')
        await window.ipc.invoke('workspace:writeFile', { path: PROFILE_FILE, data: mergeProfile(existing, block), opts: { encoding: 'utf8', mkdirp: true } })
      } catch (err) {
        // The profile is a help, not a gate: the app opens all the same.
        console.error('[onboarding] could not save the profile', err)
      }
    }
    clearSaved()
    setFinishing(false)
    setSaved(loadSaved())
    onComplete(prompt ? { prompt } : undefined)
  }, [saved.profile, lang, onComplete])

  // « I already have an account »: once joined, the app as it was left.
  useEffect(() => {
    if (open && saved.returning && saved.step === 1 && joined) {
      clearSaved()
      onComplete()
    }
  }, [open, saved.returning, saved.step, joined, onComplete])

  const signIn = async (returning: boolean) => {
    update({ returning })
    setConnecting(true)
    const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' }).catch(() => ({ success: false }))
    if (!result.success) setConnecting(false)
  }

  const chooseLang = (next: 'fr' | 'en') => {
    if (next === lang) return
    try {
      localStorage.setItem('baarali-lang', next)
    } catch {
      return
    }
    // The French layer starts with the page (desktop i18n/index.ts).
    window.location.reload()
  }

  const step = saved.step
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="flex max-h-[88dvh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Get started with Baarali</DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-8 py-9 md:px-12">
          <Stepper current={step} />
          {step === 0 && (
            <WelcomeStep
              signedIn={signedIn}
              connecting={connecting}
              onSignIn={(returning) => void signIn(returning)}
              onContinue={() => update({ step: 1, spaceSince: saved.spaceSince ?? Date.now() })}
            />
          )}
          {step === 1 && <SpaceStep since={saved.spaceSince} joined={joined} returning={saved.returning} onContinue={() => update({ step: 2 })} />}
          {step === 2 && (
            <AboutStep
              profile={saved.profile}
              lang={lang}
              onChange={(profile) => update({ profile })}
              onLang={chooseLang}
              onContinue={() => update({ step: 3 })}
              onSkip={() => update({ step: 3 })}
            />
          )}
          {step === 3 && <ToolsStep onContinue={() => update({ step: 4 })} onLater={() => update({ step: 4 })} />}
          {step === 4 && <DoneStep profile={saved.profile} finishing={finishing} onFinish={(prompt) => void finish(prompt)} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
