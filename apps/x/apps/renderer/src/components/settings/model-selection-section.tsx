import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { ModelSelector, providerDisplayNames, type ModelRef, type ModelSelection } from "@/components/model-selector"
import { useModels, type ModelPickerGroup } from "@/hooks/use-models"
import { AUTO_MODEL_ID } from "@x/shared/dist/models.js"

// The unified model-selection surface (signed-in and BYOK alike): ONE
// required Assistant model plus per-task overrides that default to
// "Same as Assistant". Every choice is explicit — a concrete model, or the
// provider-scoped "Auto" row, which persists the sentinel and follows
// Rowboat's current recommendation at run time (task inheritance from an
// Auto assistant resolves per task, so background work stays on the
// recommended lite tier). The Image model is the one slot outside that
// inheritance: it can't inherit the assistant (a text model), so it's its
// own explicit pick — or unset, which turns image generation off.

// One provider in the image-model catalog (models:listImageModels). Every
// image-capable provider lists its own models; a provider whose listing
// failed arrives as status "error" and the picker offers a Retry row.
interface ImageProviderEntry {
  id: string
  flavor: string
  status: "ok" | "error"
  error?: string
  models: string[]
}

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
  const model = ref.model === AUTO_MODEL_ID ? "Auto" : ref.model
  return `${providerDisplayNames[ref.provider] || ref.provider} · ${model}`
}

export function ModelSelectionSection({ dialogOpen }: { dialogOpen: boolean }) {
  // The effective assistant model — the same value every picker shows.
  const { defaultModel, defaultIsAuto, defaultEffort, groups } = useModels()
  const [taskModels, setTaskModels] = useState<Partial<Record<TaskKey, ModelSelection | null>>>({})
  const [imageModel, setImageModel] = useState<ModelRef | null>(null)
  const [imageProviders, setImageProviders] = useState<ImageProviderEntry[]>([])
  // The image catalog as picker groups — same shape the chat catalog
  // feeds every other field, so the Image model field is the same control.
  const imageGroups = useMemo<ModelPickerGroup[]>(() => imageProviders.map((p) => ({
    id: p.id,
    flavor: p.flavor,
    models: p.models,
    status: p.status,
    ...(p.error ? { error: p.error } : {}),
  })), [imageProviders])
  // The assistant field's value: the stored pair, reassembled from the two
  // snapshot fields the models store exposes. An Auto assistant reads back
  // as the sentinel (the STORED choice), not the model it resolved to —
  // the picker's Auto row shows the resolution as secondary text.
  const assistantSelection: ModelSelection | null = defaultModel
    ? defaultIsAuto
      ? { provider: defaultModel.provider, model: AUTO_MODEL_ID }
      : { ...defaultModel, ...(defaultEffort ? { effort: defaultEffort } : {}) }
    : null

  // Retired-model detection: the saved assistant no longer appears in its
  // provider's live list. Only trusted lists count — a failed fetch or an
  // openai-compatible endpoint (whose /models is often unreliable) must not
  // flag a working model. Auto never flags: it's a selection policy, not a
  // model that can retire — resolution already prefers listed models.
  const assistantUnavailable = (() => {
    if (!defaultModel || defaultIsAuto) return false
    const group = groups.find((g) => g.id === defaultModel.provider)
    if (!group || group.status !== "ok" || group.models.length === 0) return false
    if (group.flavor === "openai-compatible") return false
    return !group.models.includes(defaultModel.model)
  })()

  const load = useCallback(async () => {
    try {
      const cfg = await window.ipc.invoke("models:getConfig", null)
      setTaskModels(cfg.taskModels)
      setImageModel(cfg.imageModel ?? null)
    } catch {
      // Fresh install — everything inherits.
      setTaskModels({})
      setImageModel(null)
    }
  }, [])

  // Fetched on open (and on the picker's Retry): a providers-that-can-
  // generate-images list is cheap and never cached, unlike the chat catalog.
  const loadImageCatalog = useCallback(async () => {
    try {
      const catalog = await window.ipc.invoke("models:listImageModels", null)
      setImageProviders(catalog.providers)
    } catch {
      setImageProviders([])
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) {
      void load()
      void loadImageCatalog()
    }
  }, [dialogOpen, load, loadImageCatalog])

  const setAssistant = useCallback(async (selection: ModelSelection | null) => {
    // No sentinel row on the assistant picker, so the selection is never
    // null — the assistant is the one required choice. It persists whole
    // (Auto = no effort key).
    if (!selection) return
    try {
      await window.ipc.invoke("models:updateConfig", { assistantModel: selection })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save the Assistant model")
    }
  }, [])

  const setTask = useCallback(async (key: TaskKey, selection: ModelSelection | null) => {
    const previous = taskModels
    setTaskModels((prev) => ({ ...prev, [key]: selection }))
    try {
      await window.ipc.invoke("models:updateConfig", { taskModels: { [key]: selection } })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save the model")
      setTaskModels(previous)
    }
  }, [taskModels])

  const setImage = useCallback(async (selection: ModelSelection | null) => {
    const previous = imageModel
    // Image models take no effort — only the ref is stored.
    const next: ModelRef | null = selection ? { provider: selection.provider, model: selection.model } : null
    setImageModel(next)
    try {
      await window.ipc.invoke("models:updateConfig", { imageModel: next })
      window.dispatchEvent(new Event("models-config-changed"))
    } catch {
      toast.error("Failed to save the Image model")
      setImageModel(previous)
    }
  }, [imageModel])

  // One short line, same shape as the task rows': the resolved pick, or why
  // the feature is off. Provider-connection guidance belongs to the
  // providers section, not to this cell.
  const imageStatusText = imageModel
    ? `Currently uses ${refLabel(imageModel)}`
    : "Image generation is unavailable until a model is chosen."

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
          value={assistantSelection}
          effortSelectable
          onChange={(selection) => void setAssistant(selection)}
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
            // Under an Auto assistant, inheritance is category-aware (each
            // task resolves against its own recommendation slot), so don't
            // claim the assistant's resolved model runs here.
            const inheritText = key === "subagent"
              ? "Uses the spawning chat's model"
              : defaultIsAuto
                ? "Auto — uses Rowboat's recommendation for this task"
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
                  effortSelectable
                  onChange={(selection) => void setTask(key, selection)}
                  triggerTitle={label}
                />
                <p className="text-[11px] text-muted-foreground truncate" title={override ? refLabel(override) : inheritText}>
                  {override
                    ? override.model === AUTO_MODEL_ID
                      ? "Auto — uses Rowboat's recommendation for this task"
                      : "Uses a different model from the Assistant"
                    : inheritText}
                </p>
                <p className="sr-only">{description}</p>
              </div>
            )
          })}

          {/* Image model — the same cell as the task rows above, minus the
              inheritance: it can't fall back to the assistant (a text
              model), so the empty pick is "None" and turns the
              generate-image tool off rather than inheriting anything. */}
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium">Image model</span>
              {imageModel && (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground shrink-0"
                  onClick={() => void setImage(null)}
                >
                  Clear
                </button>
              )}
            </div>
            <ModelSelector
              variant="field"
              groups={imageGroups}
              inheritDefault={{ label: "None" }}
              value={imageModel}
              onChange={(selection) => void setImage(selection)}
              onRetry={() => void loadImageCatalog()}
              triggerTitle="Image model"
            />
            <p className="text-[11px] text-muted-foreground truncate" title={imageStatusText}>
              {imageStatusText}
            </p>
            <p className="sr-only">Image generation from chat</p>
          </div>
        </div>
      </div>
    </div>
  )
}
