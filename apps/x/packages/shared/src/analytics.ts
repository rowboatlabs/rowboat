import { z } from "zod";

// One taxonomy shared by legacy runs, durable turns, PostHog, and the
// Rowboat gateway. A use case describes why an LLM request was made; the
// optional sub-use-case refines that reason without changing the top-level
// reporting bucket.
export const UseCase = z.enum([
    "copilot_chat",
    "live_note_agent",
    "background_task_agent",
    "todo_item_agent",
    "meeting_note",
    "meeting_prep",
    "knowledge_sync",
    "code_session",
    "app_llm_generate",
    "app_copilot_run",
]);

export type UseCase = z.infer<typeof UseCase>;

export const TurnAnalytics = z.object({
    useCase: UseCase,
    subUseCase: z.string().optional(),
});

export type TurnAnalytics = z.infer<typeof TurnAnalytics>;
