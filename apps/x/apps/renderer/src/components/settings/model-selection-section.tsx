import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ModelSelector, providerDisplayNames, type ModelRef } from "@/components/model-selector"
import { useModels } from "@/hooks/use-models"

// The unified model-selection surface (signed-in and BYOK alike): ONE
// required Assistant model plus per-task overrides that default to
// "Same as Assistant". No "Auto" rows — every choice is an explicit model;
// recommendation logic only ever picks INITIAL models at provider-connect
// time, never appears as a dropdown option.

type TaskKey =
  | "backgroundTask"
  | "subagent"
  | "knowledgeGraph"
  | "meetingNotes"
  | "liveNoteAgent"
  | "autoPermissionDecision"
  | "chatTitle"

const TASKS: Array<{ key: TaskKey; label: string; description: string }> = [
  { key: "backgroundTask", label: "Background agents", description: "Scheduled and event-driven agents that run without a chat" },
  { key: "subagent", label: "Subagents", description: "Workers the assistant spawns during a chat" },
  { key: "knowledgeGraph", label: "Knowledge graph", description: "Note creation, email classification, knowledge sync" },
  { key: "meetingNotes", label: "Meeting notes", description: "Meeting summaries and prep briefs" },
  { key: "liveNoteAgent", label: "Live notes", description: "Self-updating notes and their routing" },
  { key: "autoPermissionDecision", label: "Permission checks", description: "Auto-approval of safe tool calls" },
  { key: "chatTitle", label: "Chat titles", description: "Naming chats from the first message" },
]

function refLabel(ref: ModelRef): string {
  return `${providerDisplayNames[ref.provider] || ref.provider} · ${ref.model}`
}

export function ModelSelectionSection({ dialogOpen }: { dialogOpen: boolean }) {
  // The effective assistant model — the same value every picker shows.
  const { defaultModel, groups } = useModels()
  const [taskModels, setTaskModels] = useState<Partial<Record<TaskKey, ModelRef | null>>>({})

  // Retired-model detection: the saved assistant no longer appears in its
  // provider's live list. Only trusted lists count — a failed fetch or an
  // openai-compatible endpoint (whose /models is often unreliable) must not
  // flag a working model.
  const assistantUnavailable = (() => {
    if (!defaultModel) return false
    const group = groups.find((g) => g.id === defaultModel.provider)
    if (!group || group.status !== "ok" || group.models.length === 0) return false
    if (group.flavor === "openai-compatible") return false
    return !group.models.includes(defaultModel.model)
  })()

  const load = useCallback(async () => {
    try {
      const cfg = await window.ipc.invoke("models:getConfig", null)
      setTaskModels(cfg.taskModels)
    } catch {
      // Fresh install — everything inherits.
      setTaskModels({})
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) void load()
  }, [dialogOpen, load])

  const setAssistant = useCallback(async (ref: ModelRef | null) => {
    // No sentinel row on the assistant picker, so ref is never null — the
    // assistant is the one required selection.
    if (!ref) return
    try {
      await window.ipc.invoke("models:updateConfig", { assistantModel: ref })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save the Assistant model")
    }
  }, [])

  const setTask = useCallback(async (key: TaskKey, ref: ModelRef | null) => {
    const previous = taskModels
    setTaskModels((prev) => ({ ...prev, [key]: ref }))
    try {
      await window.ipc.invoke("models:updateConfig", { taskModels: { [key]: ref } })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save the model")
      setTaskModels(previous)
    }
  }, [taskModels])

  return (
    <div className="space-y-6">
      {/* Assistant model — the one required primary selection. */}
      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-2">
            Assistant model
            {assistantUnavailable && (
              <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-destructive">
                Unavailable
              </span>
            )}
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Used for chat and for any task without its own model selection.
          </p>
        </div>
        <ModelSelector
          variant="field"
          value={defaultModel}
          onChange={setAssistant}
          triggerTitle="Assistant model"
        />
        {assistantUnavailable && defaultModel && (
          <p className="text-xs text-destructive">
            This model is no longer listed by {providerDisplayNames[defaultModel.provider] || defaultModel.provider}. Choose another model to continue.
          </p>
        )}
      </div>

      {/* Per-task overrides — inherit the assistant unless picked. */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold">Models for other tasks</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            These tasks use the Assistant model unless you choose a different one.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          {TASKS.map(({ key, label, description }) => {
            const override = taskModels[key] ?? null
            const inheritText = key === "subagent"
              ? "Uses the spawning chat's model"
              : defaultModel
                ? `Currently uses ${refLabel(defaultModel)}`
                : "Uses the Assistant model"
            return (
              <div key={key} className="space-y-1.5 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium">{label}</span>
                  {override && (
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground shrink-0"
                      onClick={() => void setTask(key, null)}
                    >
                      Use Assistant model
                    </button>
                  )}
                </div>
                <ModelSelector
                  variant="field"
                  allowCustom
                  inheritDefault={{ label: "Same as Assistant" }}
                  value={override}
                  onChange={(ref) => void setTask(key, ref)}
                  triggerTitle={label}
                />
                <p className="text-[11px] text-muted-foreground truncate" title={override ? refLabel(override) : inheritText}>
                  {override ? "Uses a different model from the Assistant" : inheritText}
                </p>
                <p className="sr-only">{description}</p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
