import type { AgentEvent } from './api.js';

// Reading a coding agent's own events (spec §8 Connectors: mirror, then
// interpret). Replicas streams each agent's raw events, and its OpenAPI
// documents the shapes of two: Claude Code (claude-assistant/-user/-result/
// -system around Claude SDK messages) and Codex (event_msg / response_item).
// For those two the connector shows what the agent is doing and posts its
// final answer. Cursor, OpenCode, Pi and Muse Code are documented only as
// "type + payload", so for them nothing here guesses (2026-09-30, Ramnique:
// offer all six, with fallbacks): the connector shows "Working in Replicas"
// and posts the links it knows when the turn ends. When Replicas documents
// their events, their readers go here.

export const CODING_AGENTS: Record<string, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  opencode: 'opencode',
  pi: 'pi',
  'muse-code': 'muse',
};

/** Whether the connector can read this coding agent's answers (the rest get the fallback). */
export function readsAnswers(kind: string): boolean {
  return kind === 'claude-code' || kind === 'codex';
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** One activity line for what this event shows the agent doing, if it shows anything. */
export function activityOf(kind: string, event: AgentEvent): string | undefined {
  if (kind === 'claude-code') return claudeActivity(event);
  if (kind === 'codex') return codexActivity(event);
  return undefined;
}

/** The final answer of a turn from its events, oldest first; undefined when there is none to read. */
export function answerOf(kind: string, events: AgentEvent[]): string | undefined {
  if (kind === 'claude-code') return claudeAnswer(events);
  if (kind === 'codex') return codexAnswer(events);
  return undefined;
}

/** Why the turn failed, when the agent says so (Claude's result event). */
export function failureOf(kind: string, events: AgentEvent[]): string | undefined {
  if (kind !== 'claude-code') return undefined;
  const result = [...events].reverse().find((e) => e.type === 'claude-result');
  const payload = obj(result?.payload);
  if (!payload) return undefined;
  const failed = payload.is_error === true || (str(payload.subtype) !== undefined && payload.subtype !== 'success');
  if (!failed) return undefined;
  const errors = Array.isArray(payload.errors) ? payload.errors.filter((e): e is string => typeof e === 'string') : [];
  return errors.length > 0 ? oneLine(errors.join('; '), 900) : 'Claude Code stopped with an error';
}

// --- Claude Code ------------------------------------------------------------------

function claudeBlocks(event: AgentEvent): Json[] {
  const content = obj(obj(event.payload)?.message)?.content;
  return Array.isArray(content) ? content.map(obj).filter((b): b is Json => b !== undefined) : [];
}

function claudeActivity(event: AgentEvent): string | undefined {
  if (event.type !== 'claude-assistant') return undefined;
  const tool = [...claudeBlocks(event)].reverse().find((b) => b.type === 'tool_use');
  if (!tool) return undefined;
  const name = str(tool.name) ?? 'a tool';
  const input = obj(tool.input) ?? {};
  const file = str(input.file_path) ?? str(input.path);
  switch (name) {
    case 'Bash':
      return str(input.command) ? `is running \`${oneLine(str(input.command)!, 150)}\`` : 'is running a command';
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return file ? `is editing ${oneLine(file, 150)}` : 'is editing files';
    case 'Read':
      return file ? `is reading ${oneLine(file, 150)}` : 'is reading files';
    case 'Grep':
    case 'Glob':
      return 'is searching the code';
    case 'WebSearch':
    case 'WebFetch':
      return 'is searching the web';
    default:
      return `is using ${oneLine(name, 60)}`;
  }
}

function claudeAnswer(events: AgentEvent[]): string | undefined {
  // The final assistant message of the turn itself (not a sub-agent's) that says something.
  for (const event of [...events].reverse()) {
    if (event.type !== 'claude-assistant') continue;
    if (obj(event.payload)?.parent_tool_use_id) continue;
    const text = claudeBlocks(event)
      .filter((b) => b.type === 'text')
      .map((b) => str(b.text) ?? '')
      .join('\n\n')
      .trim();
    if (text) return text;
  }
  return undefined;
}

// --- Codex --------------------------------------------------------------------------

function codexActivity(event: AgentEvent): string | undefined {
  if (event.type !== 'response_item') return undefined;
  const payload = obj(event.payload);
  if (!payload) return undefined;
  if (payload.type === 'function_call') {
    if (payload.name === 'update_plan') return 'is updating its plan';
    try {
      const args = obj(JSON.parse(str(payload.arguments) ?? '{}'));
      const command = args?.command;
      const text = Array.isArray(command) ? command.filter((c): c is string => typeof c === 'string').join(' ') : str(command);
      return text ? `is running \`${oneLine(text, 150)}\`` : 'is running a command';
    } catch {
      return 'is running a command';
    }
  }
  if (payload.type === 'custom_tool_call') return payload.name === 'apply_patch' ? 'is editing files' : `is using ${oneLine(str(payload.name) ?? 'a tool', 60)}`;
  return undefined;
}

function codexAnswer(events: AgentEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    const payload = obj(event.payload);
    if (event.type !== 'response_item' || payload?.type !== 'message' || payload.role !== 'assistant') continue;
    const content = Array.isArray(payload.content) ? payload.content : [];
    const text = content
      .map(obj)
      .map((c) => str(c?.text) ?? '')
      .join('\n\n')
      .trim();
    if (text) return text;
  }
  return undefined;
}
