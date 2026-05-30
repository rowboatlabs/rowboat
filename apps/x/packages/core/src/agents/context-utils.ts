interface AnyMessage {
  [key: string]: unknown;
  role: string;
  content: unknown;
}

/**
 * Estimates the token count for a string using a character-based heuristic.
 * ~4 characters per token is a reliable average for English/mixed content.
 * This intentionally over-estimates slightly to remain conservative.
 */

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extracts a plain-text representation of a message's content for token estimation.
 */
function getMessageText(message: AnyMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return (message.content as unknown[])
      .map((part) => {
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p["text"] === "string") return p["text"];
          if (typeof p["content"] === "string") return p["content"];
        }
        return "";
      })
      .join(" ");
  }
  return "";
}
/**
 * Truncates the message list so the estimated total token count stays within
 * `maxTokens`. The system message (if any) is always preserved. Messages are
 * dropped from the oldest end first, so the most recent context is retained.
 *
 * Tool call / tool-result pairs are kept together: if the first kept message is
 * a tool-result without a preceding tool-call, it is dropped to avoid sending
 * an unmatched tool call to the model.
 *
 * @param messages  Full conversation history.
 * @param maxTokens Token budget (default: 80,000 — conservative cross-model limit).
 * @param systemText  Optional system prompt text to deduct from the budget upfront.
 * @returns A (possibly shorter) messages array that fits within the budget.
 */
export function truncateMessagesToFit<T extends AnyMessage>(
  messages: T[],
  maxTokens = 80_000,
  systemText = "",
): T[] {
  const systemMessages = messages.filter((msg) => msg.role === "system");
  const otherMessages = messages.filter((msg) => msg.role !== "system");

  const systemTokens =
    systemMessages.reduce(
      (sum, msg) => sum + estimateTokens(getMessageText(msg)),
      0,
    ) + estimateTokens(systemText);

  let availableTokens = maxTokens - systemTokens;

  const truncatedMessages: T[] = [];

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msg = otherMessages[i];
    const msgTokens = estimateTokens(getMessageText(msg));
    if (msgTokens <= availableTokens) {
      truncatedMessages.unshift(msg);
      availableTokens -= msgTokens;
    } else {
      // Budget exhausted — drop this and all older messages

      break;
    }
  }
  // Never start with  unmatched tool-result (AI SDK requirement)
  while (truncatedMessages.length > 0 && truncatedMessages[0].role === "tool") {
    truncatedMessages.shift();
  }

  const finalMessages = [...systemMessages, ...truncatedMessages];
  if (finalMessages.length < messages.length) {
    const dropped = messages.length - finalMessages.length;
    console.log(
      `[context-utils] Truncated ${dropped} oldest message(s) to fit context window ` +
        `(budget: ${maxTokens} tokens, system: ${systemTokens} tokens).`,
    );
  }

  return finalMessages;
}
