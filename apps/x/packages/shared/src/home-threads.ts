import { z } from "zod";

// ---------------------------------------------------------------------------
// Home's operator view of threads — the registry behind the Deck.
//
// A "thread" is any session seen through Home's attention lens: a delegated
// to-do item's session, a code session, or a plain chat. The registry
// (core/home/threads.ts) derives one snapshot in the main process from the
// sessions index + the todo item↔session index + code-session meta + live
// turn-event state, so the Deck, the triage pills, and Skipper's sitrep all
// read the same feed instead of re-deriving it client-side.
// ---------------------------------------------------------------------------

export const HomeThreadKindSchema = z.enum(["task", "code", "chat"]);
export type HomeThreadKind = z.infer<typeof HomeThreadKindSchema>;

// underway   — a live turn is advancing right now (ephemeral bus state; the
//              durable index has no "running", by design).
// needs-you  — blocked on the user: a permission approval, an ask-human
//              question, or an unanswered question receipt on the item.
// ready      — finished work awaiting the user's review (code review cards;
//              emitted from phase 2 of the Helm build).
// idle       — nothing happening, nothing owed.
export const HomeThreadStatusSchema = z.enum([
    "underway",
    "needs-you",
    "ready",
    "idle",
]);
export type HomeThreadStatus = z.infer<typeof HomeThreadStatusSchema>;

export interface HomeThread {
    sessionId: string;
    kind: HomeThreadKind;
    status: HomeThreadStatus;
    title: string;
    /** Why it needs you (question text / "waiting for approval"), when
     * status is needs-you. */
    attention?: string;
    /** One-line live activity while underway — the current tool's name, or
     * "thinking" between calls. Ephemeral; never persisted. */
    activity?: string;
    /** The todo item key when kind is 'task' — the Deck strip's jump target
     * on the list. */
    todoKey?: string;
    /** Code-session context when kind is 'code'. */
    code?: { projectId: string; projectName: string; agent: string; branch?: string };
    updatedAt: string;
    /** When the live turn started, while underway (elapsed display). */
    startedAt?: string;
    /** Kept on the Deck even while idle (the operator's watch flag). */
    pinned: boolean;
    /** Stable recall slot when pinned (0-based; keys 1–9 jump by slot).
     * Order is the pin order, so slots never reshuffle. */
    pinIndex?: number;
    /** Snoozed out of the needs-you bay — returns at the chosen time or on
     * new activity, whichever comes first (the Linear tripwire). */
    snoozed?: boolean;
    /** Updated since the user last looked at this thread. */
    unseen: boolean;
}
