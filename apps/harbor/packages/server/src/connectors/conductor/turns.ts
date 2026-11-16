import { activityOf, answerOf, failureOf, type AgentEvent } from '../common/agent-events.js';
import type { TranscriptMessage } from './api.js';

// Reading a Conductor session's transcript (spec §8 Connectors). Conductor's
// OpenAPI leaves `content` undocumented; read live on 2026-10-07, each entry
// is one of:
//   { type: 'userMessage', id, message, turnId, … }   — a request we sent; its id and turnId are our messageId
//   { type: 'agent', rawPayload, turnId, userMessageId } — one Claude Code SDK message (assistant / user /
//       result / system), or Conductor's own (`command_lifecycle`; system `session_state_changed`)
// `turnId` is the messageId the request was sent with, so a turn's entries are
// found by it, and the turn ends with `session_state_changed` → `idle`. The
// SDK messages are brought to the event shape the Replicas readers already
// understand — `claude-<type>` around the message — and read by them. A
// content that is itself an SDK message, or plain text, is read too.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);

function contentOf(entry: TranscriptMessage): unknown {
  if (typeof entry.content !== 'string') return entry.content;
  try {
    return JSON.parse(entry.content) as unknown;
  } catch {
    return entry.content;
  }
}

/** The SDK message an entry carries: its `rawPayload`, or the content itself. */
function payloadOf(entry: TranscriptMessage): unknown {
  const content = contentOf(entry);
  return obj(content)?.rawPayload ?? content;
}

/** The request an entry belongs to: the messageId it was sent with. */
export function turnOf(entry: TranscriptMessage): string | undefined {
  const turnId = obj(contentOf(entry))?.turnId;
  return typeof turnId === 'string' ? turnId : undefined;
}

/** A request we sent, as the transcript records it. */
export function isRequest(entry: TranscriptMessage): boolean {
  return entry.type === 'userMessage' || obj(contentOf(entry))?.type === 'userMessage';
}

/** Conductor's own mark that a turn is over: the session went idle. */
export function endsTurn(entry: TranscriptMessage): boolean {
  const raw = obj(payloadOf(entry));
  return raw?.type === 'system' && raw.subtype === 'session_state_changed' && raw.state === 'idle';
}

/** An entry as a Claude Code event: the SDK message's own `type` wins over the entry's. */
export function asClaudeEvent(entry: TranscriptMessage): AgentEvent {
  const payload = payloadOf(entry);
  const message = obj(payload);
  const type = (typeof message?.type === 'string' ? message.type : entry.type).replace(/^claude-/, '');
  if (message) return { type: `claude-${type}`, payload: message, timestamp: entry.receivedAt };
  // Plain text: an assistant message with one text block.
  return {
    type: `claude-${type}`,
    payload: { message: { content: typeof payload === 'string' ? [{ type: 'text', text: payload }] : [] } },
    timestamp: entry.receivedAt,
  };
}

const KIND = 'claude-code';

export function transcriptActivity(entry: TranscriptMessage): string | undefined {
  return activityOf(KIND, asClaudeEvent(entry));
}

export function transcriptAnswer(entries: TranscriptMessage[]): string | undefined {
  return answerOf(KIND, entries.filter((e) => !isRequest(e)).map(asClaudeEvent));
}

export function transcriptFailure(entries: TranscriptMessage[]): string | undefined {
  return failureOf(KIND, entries.filter((e) => !isRequest(e)).map(asClaudeEvent));
}

/** Whether an entry carries this text anywhere (the request marker, for entries without a turnId). */
export function mentions(entry: TranscriptMessage, text: string): boolean {
  return JSON.stringify(entry.content ?? '').includes(text);
}
