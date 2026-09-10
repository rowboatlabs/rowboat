// The two spaces procedures that appear in TWO places: inside the spaces skill
// (model-activated, for chat-started sessions) and as the eager system-prompt
// fragment pinned on a space-thread session (capabilities/modes.ts, where the
// ids are filled in). One source so the wording can never drift between them.

export interface ThreadContext {
    spaceName: string;
    spaceId: string;
    threadRootId: string;
    /** The org to pass as `org` on every spaces tool call; omit when only one org is registered. */
    org?: string;
}

/**
 * "When invoked from a thread" — the receipt contract. With `ctx`, the ids are
 * concrete (the pinned form); without, the generic form the skill carries.
 */
export function threadProcedure(ctx?: ThreadContext): string {
    const root = ctx ? ctx.threadRootId : "<rootId>";
    const where = ctx
        ? `You are in a session bound to one thread in the space "${ctx.spaceName}" (spaceId ${ctx.spaceId}, thread root ${ctx.threadRootId})${ctx.org ? `, org "${ctx.org}" — pass org: "${ctx.org}" on every spaces tool call` : ""}. ` +
          "Messages here arrive because your person typed `@rowboat …` in that thread; the whole room saw the ask."
        : "Your person typed `@rowboat …` in a space. The message tells you the space and the thread root. The whole room saw the ask.";
    return [
        "## When invoked from a thread",
        "",
        `${where} Your reply is the team's receipt.`,
        "",
        "- If the task is about the conversation, `read_thread` first.",
        `- Do the work. Any \`propose_change\` reason ends with \` · thread:${root}\` — that files the change under this thread.`,
        `- End with exactly one \`post_message\` reply into that thread (threadRoot ${root}): outcome first, one or two sentences. If you could not do it, say what blocked you.`,
        "- Your reply answers the ask. Nothing you read while working goes in it unless it is the answer.",
        "- No \"on it\", no progress posts. One reply.",
        "- Follow-up `@rowboat` messages may arrive while you work. Fold them in; still one reply covering what actually happened.",
    ].join("\n");
}

export const PRIVACY_RULES = [
    "## Privacy",
    "",
    "Everything you post lands in front of the team. Everything you read might be private to your person.",
    "",
    "- **Read only what the task needs.** \"Message Harsh\" needs a member id, not the HR directory. Do not open other DMs, private spaces, or files to \"gather context\" unless the ask requires it.",
    "- **Answer only what was asked.** What you saw in other tool calls, files, DMs, emails, or notes along the way does not go into the reply. \"Who is on call?\" gets a name, not the on-call spreadsheet.",
    "- **Private to shared crosses only on request, as a summary.** When your person says \"add my meeting notes to the roadmap\", write what the room needs from them, not the notes themselves. Never paste emails, chats, or DM content into a shared space.",
    "- **A receipt says what you did, not what you read.**",
].join("\n");
