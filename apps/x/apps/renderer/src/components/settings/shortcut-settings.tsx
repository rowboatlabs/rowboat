"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useQuickAskShortcut } from "@/hooks/use-quick-ask-shortcut"
import {
  DEFAULT_QUICK_ASK_SHORTCUT,
  eventCodeToShortcutKey,
  formatShortcut,
  shortcutDisplayParts,
  type ShortcutModifier,
} from "@x/shared/src/quick-ask-shortcut.js"

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")

const MOD_GLYPHS: Record<ShortcutModifier, string> = isMac
  ? { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", Super: "⌘" }
  : { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Command: "Win", Super: "Win" }
const KEY_GLYPHS: Record<string, string> = {
  Up: "↑", Down: "↓", Left: "←", Right: "→",
  Enter: "↵", Backspace: "⌫", Delete: "⌦",
}

/** Modifiers currently held, read off the event, in canonical order. */
function heldModifiers(e: KeyboardEvent): ShortcutModifier[] {
  const mods: ShortcutModifier[] = []
  if (e.ctrlKey) mods.push("Control")
  if (e.altKey) mods.push("Alt")
  if (e.shiftKey) mods.push("Shift")
  if (e.metaKey) mods.push(isMac ? "Command" : "Super")
  return mods
}

function Keycap({
  children,
  ghost,
  size = "md",
}: {
  children: React.ReactNode
  ghost?: boolean
  size?: "md" | "lg"
}) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        size === "lg" ? "h-11 min-w-11 px-3 text-lg" : "h-8 min-w-8 px-2 text-[13px]",
        ghost
          ? "border border-dashed border-muted-foreground/40 text-muted-foreground/60"
          : "border border-border bg-muted text-foreground shadow-[inset_0_-1.5px_0_rgba(0,0,0,0.08)] dark:shadow-[inset_0_-1.5px_0_rgba(255,255,255,0.06)]",
      )}
    >
      {children}
    </kbd>
  )
}

type PendingChord = { mods: ShortcutModifier[]; key: string }

/**
 * The Shortcuts tab: the current Quick Ask chord, changed through a modal
 * recorder. The modal shows every key the user presses live as keycaps,
 * holds the last complete chord (1–2 modifiers + one key), and only applies
 * it on an explicit Save — pressing another combination before saving simply
 * replaces the pending one. Rejections (shape violations, system-reserved
 * chords, or the OS refusing the grab because another app owns it) surface
 * inline in the modal and leave the existing binding untouched.
 */
export function ShortcutSettings() {
  const current = useQuickAskShortcut()
  const [open, setOpen] = useState(false)
  const [heldMods, setHeldMods] = useState<ShortcutModifier[]>([])
  const [pending, setPending] = useState<PendingChord | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const resetCapture = useCallback(() => {
    setHeldMods([])
    setPending(null)
    setHint(null)
    setError(null)
    setSaving(false)
    savingRef.current = false
  }, [])

  const openModal = useCallback(() => {
    resetCapture()
    setOpen(true)
  }, [resetCapture])

  const closeModal = useCallback(() => {
    setOpen(false)
    resetCapture()
  }, [resetCapture])

  const apply = useCallback(
    async (accelerator: string | null): Promise<boolean> => {
      if (savingRef.current) return false
      savingRef.current = true
      setSaving(true)
      try {
        const res = await window.ipc.invoke("quickAsk:setShortcut", { accelerator })
        if (res.ok) return true
        setError(res.error ?? "That shortcut can’t be used.")
        return false
      } catch {
        setError("Couldn’t update the shortcut. Try again.")
        return false
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [],
  )

  const save = useCallback(async () => {
    if (!pending) return
    if (await apply([...pending.mods, pending.key].join("+"))) closeModal()
  }, [pending, apply, closeModal])

  // While the modal is up, main releases the current global chord —
  // otherwise pressing it would summon the companion over the recorder
  // instead of showing up as keycaps here.
  useEffect(() => {
    if (!open) return
    void window.ipc.invoke("quickAsk:setShortcutCaptureActive", { active: true }).catch(() => {})
    return () => {
      void window.ipc.invoke("quickAsk:setShortcutCaptureActive", { active: false }).catch(() => {})
    }
  }, [open])

  // Capture-phase listeners while the modal is up: keys tried out here must
  // reach nothing else in the app. Esc always closes (cancel).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        closeModal()
        return
      }
      const mods = heldModifiers(e)
      const isModifierKey = ["Control", "Alt", "Shift", "Meta"].includes(e.key)
      if (isModifierKey) {
        setHeldMods(mods)
        setError(null)
        setHint(mods.length > 2 ? "Use at most two modifier keys" : null)
        return
      }
      // A regular key landed — try to complete a chord.
      if (mods.length === 0) {
        setHint(isMac ? "Hold a modifier first — ⌃, ⌥ or ⌘" : "Hold a modifier first — Ctrl, Alt or Win")
        return
      }
      if (mods.length > 2) {
        setHint("Use at most two modifier keys")
        return
      }
      if (mods.every((m) => m === "Shift")) {
        setHint(isMac ? "Include ⌃, ⌥ or ⌘ — Shift alone is just typing" : "Include Ctrl, Alt or Win")
        return
      }
      const key = eventCodeToShortcutKey(e.code)
      if (!key) {
        setHint("That key can’t be part of a shortcut")
        return
      }
      setPending({ mods, key })
      setHint(null)
      setError(null)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setHeldMods(heldModifiers(e))
    }
    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    return () => {
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
    }
  }, [open, closeModal])

  const currentParts = shortcutDisplayParts(current.accelerator, isMac)
  // heldModifiers() builds modifiers in canonical order, so a plain join
  // matches the normalized accelerator from main.
  const pendingIsCurrent =
    pending !== null && [...pending.mods, pending.key].join("+") === current.accelerator
  // Stage display: keys being held right now win; otherwise the last
  // complete chord; otherwise the waiting placeholder.
  const stage: React.ReactNode = heldMods.length > 0 ? (
    <>
      {heldMods.map((m) => (
        <Keycap key={m} size="lg">{MOD_GLYPHS[m]}</Keycap>
      ))}
      <Keycap ghost size="lg">key</Keycap>
    </>
  ) : pending ? (
    <>
      {pending.mods.map((m) => (
        <Keycap key={m} size="lg">{MOD_GLYPHS[m]}</Keycap>
      ))}
      <Keycap size="lg">{KEY_GLYPHS[pending.key] ?? pending.key}</Keycap>
    </>
  ) : (
    <span className="animate-pulse text-sm text-muted-foreground">Press a key combination…</span>
  )

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium mb-3">Quick Ask</h4>
        <p className="text-xs text-muted-foreground mb-4">
          Summon your Skipper from anywhere — press the shortcut in any app to talk or type; press it again to tuck the text away.
        </p>
        <div className="rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm font-medium">Keyboard shortcut</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                One or two modifiers plus a key
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!current.isDefault && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground"
                  onClick={() => void apply(null)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset to {formatShortcut(DEFAULT_QUICK_ASK_SHORTCUT, isMac)}
                </Button>
              )}
              <button
                type="button"
                onClick={openModal}
                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 transition-colors hover:bg-muted/60"
                aria-label="Change shortcut"
              >
                {currentParts.map((part, i) => (
                  <Keycap key={i}>{part}</Keycap>
                ))}
              </button>
            </div>
          </div>
          {!current.registered && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>
                Not active — another app is using {formatShortcut(current.accelerator, isMac)}.
                Pick a different shortcut, or free it up in the other app and{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={() => void apply(current.accelerator)}
                >
                  try again
                </button>
                .
              </span>
            </div>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!next) closeModal() }}>
        <DialogContent className="sm:max-w-[420px]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Change shortcut</DialogTitle>
            <DialogDescription>
              Press the new combination — one or two modifiers plus a key.
            </DialogDescription>
          </DialogHeader>
          <div
            className={cn(
              "flex h-24 items-center justify-center gap-2 rounded-lg border transition-colors",
              pending && heldMods.length === 0
                ? "border-primary/60 bg-primary/5"
                : "border-dashed border-border bg-muted/30",
            )}
          >
            {stage}
          </div>
          <div className="min-h-4 -mt-1">
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : hint ? (
              <p className="text-xs text-amber-600 dark:text-amber-500">{hint}</p>
            ) : pendingIsCurrent ? (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This is already your current shortcut — press a different combination.
              </p>
            ) : pending ? (
              <p className="text-xs text-muted-foreground">
                Press another combination to replace it, or save.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Esc to cancel</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!pending || pendingIsCurrent || saving}>
              {saving ? "Saving…" : "Save shortcut"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
