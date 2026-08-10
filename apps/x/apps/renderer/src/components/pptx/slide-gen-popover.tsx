import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { humanizeModelError } from '@/lib/billing-error'

type Mode = 'edit' | 'new'

export interface SlideGenPopoverProps {
  onGenerate: (topic: string | null) => Promise<{ error?: string }>
  /** Present on a slide card; absent on the rail header (nothing to edit). */
  onEdit?: (instruction: string) => Promise<{ error?: string }>
  defaultMode?: Mode
  trigger: ReactNode
}

/**
 * The sparkle popover. One input, two modes:
 *  - "Edit this slide" (only when `onEdit` is given): the input is an
 *    instruction, applied by a single Apply button.
 *  - "New slide": the input is an optional topic — Suggest (no topic) /
 *    Generate (with topic).
 * The action returns `{ error }` on failure, shown inline with Retry; on
 * success the popover closes. It stays open and busy while the model runs so
 * a failure is never silent and nothing partial is shown.
 */
export function SlideGenPopover({ onGenerate, onEdit, defaultMode = 'new', trigger }: SlideGenPopoverProps) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>(onEdit ? defaultMode : 'new')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastRef = useRef<{ mode: Mode; text: string | null } | null>(null)

  const run = useCallback(
    async (action: { mode: Mode; text: string | null }) => {
      lastRef.current = action
      setBusy(true)
      setError(null)
      try {
        const res =
          action.mode === 'edit' && onEdit
            ? await onEdit(action.text ?? '')
            : await onGenerate(action.text)
        if (res.error) {
          setError(humanizeModelError(res.error))
          return
        }
        setOpen(false)
        setText('')
      } finally {
        setBusy(false)
      }
    },
    [onGenerate, onEdit],
  )

  const submit = useCallback(() => {
    if (!text.trim()) return
    void run({ mode, text: text.trim() })
  }, [mode, text, run])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          // Reset per opening, never mid-session (a tab click must stick).
          setMode(onEdit ? defaultMode : 'new')
          setText('')
          setError(null)
        }
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="grid gap-2">
          {onEdit ? (
            <div className="flex gap-1 rounded-md bg-muted p-0.5">
              {(['edit', 'new'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    setError(null)
                  }}
                  aria-pressed={mode === m}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                    mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m === 'edit' ? 'Edit this slide' : 'New slide after this'}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-xs font-medium">New slide</div>
          )}
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'edit'
                ? 'What should change? (e.g. change 15% to 200%)'
                : 'What should this slide cover? (e.g. Competitive landscape)'
            }
            disabled={busy}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) {
                e.preventDefault()
                submit()
              }
            }}
          />
          {error && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
              {/* Wraps rather than truncates: the actionable half of a mapped
                  message ("…configure your own API key in Settings") is the
                  part a single line would cut off. */}
              <span className="min-w-0">{error}</span>
              <button
                type="button"
                className="shrink-0 font-medium underline"
                onClick={() => lastRef.current && void run(lastRef.current)}
              >
                Retry
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            {busy ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                {mode === 'edit' ? 'Editing…' : 'Generating…'}
              </span>
            ) : (
              <span />
            )}
            {mode === 'edit' ? (
              <Button size="xs" disabled={busy || !text.trim()} onClick={submit}>
                Apply
              </Button>
            ) : (
              <div className="flex gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run({ mode: 'new', text: null })}
                >
                  Suggest
                </Button>
                <Button size="xs" disabled={busy || !text.trim()} onClick={submit}>
                  Generate
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
