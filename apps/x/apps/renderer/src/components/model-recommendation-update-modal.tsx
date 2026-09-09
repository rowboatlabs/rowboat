"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight } from "lucide-react"
import { toast } from "sonner"
import type { IPCChannels } from "@x/shared/dist/ipc.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { providerDisplayNames, type ModelSelection } from "@/components/model-selector"
import { TASK_SLOTS } from "@/components/settings/task-slots"

/** The pending update as served by models:checkRecommendationUpdate. */
export type RecommendationUpdate = Extract<
  IPCChannels["models:checkRecommendationUpdate"]["res"],
  { shouldShow: true }
>
type Row = RecommendationUpdate["rows"][number]
type SlotKey = Row["slot"]

const TASK_LABELS: Record<string, string> = Object.fromEntries(TASK_SLOTS.map((t) => [t.key, t.label]))

function choiceLabel(choice: ModelSelection): string {
  return choice.effort ? `${choice.model} · ${choice.effort} effort` : choice.model
}

/**
 * "Switch to recommended models": the per-slot diff between the backend's
 * current recommendation for the provider serving the assistant and the
 * saved config, offered once per recommendation version. Every row is a
 * checkbox (all checked by default); Switch writes the checked slots, Not
 * Now writes nothing. Both — and closing the dialog any other way — answer
 * the prompt for this version, so it does not return until the backend's
 * recommendation changes again. The write itself happens main-side
 * (models:resolveRecommendationUpdate), which re-derives the rows before
 * applying so a stale dialog cannot clobber an edit made while it was open.
 *
 * Checkboxes, not switches: nothing changes until Switch is pressed, and a
 * switch promises an immediate effect. Copy follows the Apple dialog
 * pattern — a verb-led title, one plain sentence of context, and a primary
 * button that repeats the title's verb.
 */
export function ModelRecommendationUpdateModal({
  update,
  onClose,
}: {
  update: RecommendationUpdate | null
  onClose: () => void
}) {
  const [checked, setChecked] = useState<Set<SlotKey>>(new Set())
  const [busy, setBusy] = useState(false)
  // Whether this update has been answered (apply / not now). Closing the
  // dialog without answering — Escape, overlay click — counts as Not now.
  const answered = useRef(false)

  useEffect(() => {
    if (!update) return
    setChecked(new Set(update.rows.map((r) => r.slot)))
    setBusy(false)
    answered.current = false
  }, [update])

  const assistantRow = useMemo(() => update?.rows.find((r) => r.slot === "assistantModel") ?? null, [update])
  const taskRows = useMemo(() => update?.rows.filter((r) => r.slot !== "assistantModel") ?? [], [update])

  if (!update) return null

  const providerName = providerDisplayNames[update.flavor] || update.flavor
  const currentAssistant = update.assistantModel
  // Inherit rows show "Same as Assistant"; the resolved model rides in the tooltip.
  const inheritNow = "Same as Assistant"
  const inheritNowTitle = `Same as Assistant (${choiceLabel(currentAssistant)})`
  const tasksChecked = taskRows.filter((r) => checked.has(r.slot)).length
  const assistantChecked = assistantRow ? checked.has("assistantModel") : false
  const someTasksUnchecked = tasksChecked < taskRows.length

  const toggle = (slot: SlotKey, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (on) next.add(slot)
      else next.delete(slot)
      return next
    })
  }

  const toggleAllTasks = (on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const row of taskRows) {
        if (on) next.add(row.slot)
        else next.delete(row.slot)
      }
      return next
    })
  }

  const resolve = async (apply: SlotKey[]) => {
    if (answered.current) return
    answered.current = true
    setBusy(true)
    try {
      const result = await window.ipc.invoke("models:resolveRecommendationUpdate", {
        flavor: update.flavor,
        hash: update.hash,
        apply,
      })
      if (result.applied.length > 0) {
        window.dispatchEvent(new Event("models-config-changed"))
        toast.success(
          result.applied.length === 1 ? "Switched to the recommended model" : "Switched to the recommended models",
        )
      }
    } catch (error) {
      console.error("[models] Could not resolve the recommendation update:", error)
      if (apply.length > 0) toast.error("Couldn't switch models. You can change them in Settings.")
    } finally {
      setBusy(false)
      onClose()
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void resolve([])
      }}
    >
      <DialogContent className="w-[min(30rem,calc(100%-2rem))] max-w-lg p-0 gap-0 overflow-hidden rounded-xl">
        <div className="p-6 pb-0">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold">Switch to recommended models?</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Rowboat has new recommendations for {providerName}. Choose the models you&apos;d like
              to switch.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pt-4 space-y-4">
          {assistantRow && (
            <RowLine
              id="rec-assistant"
              label="Assistant"
              current={assistantRow.current ? choiceLabel(assistantRow.current) : inheritNow}
              currentTitle={assistantRow.current ? undefined : inheritNowTitle}
              recommended={assistantRow.recommended ? choiceLabel(assistantRow.recommended) : "Same as Assistant"}
              checked={assistantChecked}
              disabled={busy}
              onChange={(on) => toggle("assistantModel", on)}
            />
          )}

          {taskRows.length > 0 && (
            <div className="space-y-2">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Background tasks"
                  className="size-4 shrink-0 cursor-pointer accent-[#2383E2]"
                  checked={tasksChecked === taskRows.length}
                  ref={(el) => {
                    if (el) el.indeterminate = tasksChecked > 0 && tasksChecked < taskRows.length
                  }}
                  disabled={busy}
                  onChange={(e) => toggleAllTasks(e.target.checked)}
                />
                <span className="text-sm font-medium">
                  Background tasks
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {taskRows.length === 1 ? "1 model" : `${taskRows.length} models`}
                  </span>
                </span>
              </label>
              <div className="ml-6 space-y-2 border-l pl-3.5">
                {taskRows.map((row) => (
                  <RowLine
                    key={row.slot}
                    id={`rec-${row.slot}`}
                    label={TASK_LABELS[row.slot] ?? row.slot}
                    current={row.current ? choiceLabel(row.current) : inheritNow}
                    currentTitle={row.current ? undefined : inheritNowTitle}
                    recommended={row.recommended ? choiceLabel(row.recommended) : "Same as Assistant"}
                    checked={checked.has(row.slot)}
                    disabled={busy}
                    onChange={(on) => toggle(row.slot, on)}
                  />
                ))}
              </div>
              {assistantChecked && someTasksUnchecked && (
                <p className="ml-6 text-[11px] text-muted-foreground">
                  Tasks you don&apos;t switch keep following the Assistant, so they&apos;ll use the new
                  Assistant model.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 mt-6 border-t bg-muted/30">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void resolve([])}>
            Not Now
          </Button>
          <Button
            size="sm"
            disabled={busy || checked.size === 0}
            onClick={() => void resolve(update.rows.map((r) => r.slot).filter((s) => checked.has(s)))}
          >
            Switch
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function RowLine({
  id,
  label,
  current,
  currentTitle,
  recommended,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  current: string
  currentTitle?: string
  recommended: string
  checked: boolean
  disabled: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2.5 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        aria-label={label}
        className="mt-[3px] size-4 shrink-0 cursor-pointer accent-[#2383E2]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="flex items-center gap-1.5 min-w-0">
          <Pill tone="current" title={currentTitle ?? current}>{current}</Pill>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <Pill tone="next" title={recommended}>{recommended}</Pill>
        </span>
      </span>
    </label>
  )
}

function Pill({ tone, title, children }: { tone: "current" | "next"; title: string; children: string }) {
  return (
    <span
      title={title}
      className={
        tone === "next"
          ? "inline-block max-w-[14rem] truncate rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
          : "inline-block max-w-[14rem] truncate rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      }
    >
      {children}
    </span>
  )
}
