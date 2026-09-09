// The per-task model override slots as the settings UI names them. Shared
// by the model-selection section and the recommendation-update prompt so
// both label a slot the same way. Keys mirror shared/models.ts TaskModels.

export type TaskKey =
  | "backgroundTask"
  | "subagent"
  | "knowledgeGraph"
  | "meetingNotes"
  | "liveNoteAgent"
  | "autoPermissionDecision"
  | "chatTitle"

export const TASK_SLOTS: Array<{ key: TaskKey; label: string; description: string }> = [
  { key: "backgroundTask", label: "Background agents", description: "Scheduled and event-driven agents that run without a chat" },
  { key: "subagent", label: "Subagents", description: "Workers the assistant spawns during a chat" },
  { key: "knowledgeGraph", label: "Knowledge graph", description: "Note creation, email classification, knowledge sync" },
  { key: "meetingNotes", label: "Meeting notes", description: "Meeting summaries and prep briefs" },
  { key: "liveNoteAgent", label: "Live notes", description: "Self-updating notes and their routing" },
  { key: "autoPermissionDecision", label: "Permission checks", description: "Auto-approval of safe tool calls" },
  { key: "chatTitle", label: "Chat titles", description: "Naming chats from the first message" },
]
