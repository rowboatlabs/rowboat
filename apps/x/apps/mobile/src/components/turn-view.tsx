import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import Markdown from 'react-native-markdown-display';
import type { message as messageShared, turns } from '@x/shared';
import type { z } from 'zod';

// Renders one turn from its reduced TurnState (the same reducer the desktop
// uses), plus the live streaming-text overlay for the in-flight model call.
// v1 render set: user bubble, assistant markdown, tool-call chips, permission
// and ask-human prompts, terminal errors. Attachments/code runs come later.

// Same extraction as the desktop's turn view: only `text` parts render.
// `reasoning` parts also carry a .text field (the model thinking out loud)
// and are dropped, exactly like apps/renderer's session-chat/turn-view.ts.
function textParts(content: string | Array<{ type?: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
}

function userText(input: z.infer<typeof messageShared.UserMessage>): string {
  return textParts(input.content as string | Array<{ type?: string; text?: string }>);
}

function assistantText(response: z.infer<typeof messageShared.AssistantMessage>): string {
  return textParts(response.content as string | Array<{ type?: string; text?: string }>);
}

function ToolChip({ tool }: { tool: turns.ToolCallState }) {
  const failed = tool.result?.result.isError === true;
  const running = !tool.result;
  return (
    <View style={[styles.chip, failed && styles.chipFailed]}>
      <Text style={[styles.chipText, { color: '#999' }]}>
        {running ? '⏳' : failed ? '✕' : '✓'} {tool.toolName}
      </Text>
    </View>
  );
}

function PermissionPrompt({
  pending,
  onDecision,
}: {
  pending: { toolCallId: string; toolName: string };
  onDecision: (toolCallId: string, decision: 'allow' | 'deny') => void;
}) {
  return (
    <View style={styles.promptCard}>
      <Text style={styles.promptTitle}>Rowboat wants to run “{pending.toolName}”</Text>
      <View style={styles.promptButtons}>
        <Button title="Allow" onPress={() => onDecision(pending.toolCallId, 'allow')} />
        <Button title="Deny" color="#c0392b" onPress={() => onDecision(pending.toolCallId, 'deny')} />
      </View>
    </View>
  );
}

function AskHumanPrompt({
  toolCallId,
  question,
  options,
  onAnswer,
}: {
  toolCallId: string;
  question: string;
  options?: string[];
  onAnswer: (toolCallId: string, answer: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <View style={styles.promptCard}>
      <Text style={styles.promptTitle}>{question}</Text>
      {options?.map((option) => (
        <Button key={option} title={option} onPress={() => onAnswer(toolCallId, option)} />
      ))}
      <View style={styles.promptRow}>
        <TextInput
          style={styles.promptInput}
          placeholder="Type an answer…"
          value={draft}
          onChangeText={setDraft}
        />
        <Button title="Send" disabled={!draft.trim()} onPress={() => onAnswer(toolCallId, draft.trim())} />
      </View>
    </View>
  );
}

export interface TurnViewProps {
  state: turns.TurnState;
  liveText?: string;
  streaming?: boolean;
  onPermission?: (toolCallId: string, decision: 'allow' | 'deny') => void;
  onAskHuman?: (toolCallId: string, answer: string) => void;
}

export function TurnView({ state, liveText, streaming, onPermission, onAskHuman }: TurnViewProps) {
  const scheme = useColorScheme();
  const textColor = scheme === 'dark' ? '#fff' : '#000';

  const suspended = state.terminal ? undefined : state.suspension;
  const askHumanCalls = state.toolCalls.filter(
    (tc) => tc.toolName === 'ask-human' && !tc.result,
  );

  return (
    <View style={styles.turn}>
      <View style={styles.userBubble}>
        <Text style={styles.userText}>{userText(state.definition.input)}</Text>
      </View>

      {state.modelCalls.map((call) => {
        const tools = state.toolCalls.filter((tc) => tc.modelCallIndex === call.index);
        const answer = call.response ? assistantText(call.response) : '';
        return (
          <View key={call.index} style={styles.assistantBlock}>
            {answer.length > 0 && (
              <Markdown style={{ body: { color: textColor, fontSize: 15 } }}>{answer}</Markdown>
            )}
            {call.error && <Text style={styles.error}>{call.error}</Text>}
            {tools.length > 0 && (
              <View style={styles.chips}>
                {tools.map((tool) => (
                  <ToolChip key={tool.toolCallId} tool={tool} />
                ))}
              </View>
            )}
          </View>
        );
      })}

      {liveText ? (
        <Markdown style={{ body: { color: textColor, fontSize: 15 } }}>{liveText}</Markdown>
      ) : null}
      {streaming && !liveText && !state.terminal && !suspended && (
        <Text style={styles.thinking}>Thinking…</Text>
      )}

      {suspended &&
        onPermission &&
        suspended.pendingPermissions.map((pending) => (
          <PermissionPrompt key={pending.toolCallId} pending={pending} onDecision={onPermission} />
        ))}
      {suspended &&
        onAskHuman &&
        askHumanCalls.map((tc) => {
          const input = tc.input as { question?: string; options?: string[] } | undefined;
          return (
            <AskHumanPrompt
              key={tc.toolCallId}
              toolCallId={tc.toolCallId}
              question={input?.question ?? 'Rowboat has a question'}
              options={input?.options}
              onAnswer={onAskHuman}
            />
          );
        })}

      {state.terminal?.type === 'turn_failed' && (
        <Text style={styles.error}>Turn failed: {String(state.terminal.error ?? 'unknown error')}</Text>
      )}
      {state.terminal?.type === 'turn_cancelled' && <Text style={styles.meta}>Stopped.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  turn: { gap: 8, marginBottom: 20 },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#3478f6',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: '85%',
  },
  userText: { color: '#fff', fontSize: 15 },
  assistantBlock: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#8882',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipFailed: { backgroundColor: '#c0392b22' },
  chipText: { fontSize: 12, opacity: 0.8 },
  promptCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#8886',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  promptTitle: { fontSize: 14, fontWeight: '500', color: '#888' },
  promptButtons: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  promptRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#999',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
  },
  thinking: { opacity: 0.6, fontStyle: 'italic', color: '#888' },
  error: { color: '#c0392b' },
  meta: { opacity: 0.5, fontSize: 13 },
});
