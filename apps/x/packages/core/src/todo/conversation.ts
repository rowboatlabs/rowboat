import { reduceTurn } from '@x/shared/dist/turns.js';
import type { TodoChatBubble, TodoLink } from '@x/shared/dist/todo.js';
import type { ISessions } from '../runtime/sessions/api.js';
import { assistantText } from '../runtime/assembly/headless.js';
import { PrefixLogger } from '@x/shared/dist/prefix-logger.js';
import { getSessionId } from './session-index.js';

const log = new PrefixLogger('Todo:Conversation');

// ---------------------------------------------------------------------------
// The compact conversation view of an item's session — what the list renders
// as chat bubbles under the to-do. Derived, never stored: the session is the
// history; this is a lens that keeps only each turn's user message and the
// agent's final reply (plus todo-report links), not the tool-call play-by-play.
// ---------------------------------------------------------------------------

const FIRST_MESSAGE_PREFIX = 'Work on this item from the user';
const CONTEXT_MARKER = '**Context from the user:**';

function messageText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
                    return (part as { text: string }).text;
                }
                return '';
            })
            .join('');
    }
    return '';
}

/** The user bubble for a turn — the runner's framed first message renders as
 * just its Context block (the user's own words), or nothing at all. */
function userBubbleText(raw: string): string | null {
    if (!raw.startsWith(FIRST_MESSAGE_PREFIX)) return raw;
    const idx = raw.indexOf(CONTEXT_MARKER);
    if (idx === -1) return null;
    const context = raw.slice(idx + CONTEXT_MARKER.length).trim();
    return context || null;
}

function reportLinks(input: unknown): TodoLink[] {
    if (!input || typeof input !== 'object') return [];
    const links = (input as { links?: unknown }).links;
    if (!Array.isArray(links)) return [];
    return links.filter(
        (l): l is TodoLink =>
            !!l && typeof l === 'object' && typeof (l as { label?: unknown }).label === 'string',
    );
}

export async function getConversation(
    sessions: ISessions,
    key: string,
): Promise<{ sessionId: string | null; bubbles: TodoChatBubble[] }> {
    const sessionId = await getSessionId(key);
    if (!sessionId) return { sessionId: null, bubbles: [] };
    return deriveConversation(sessions, sessionId);
}

/** Same compact lens, for any session — the home stream's chat threads use
 * this directly by sessionId. */
export async function deriveConversation(
    sessions: ISessions,
    sessionId: string,
): Promise<{ sessionId: string | null; bubbles: TodoChatBubble[] }> {
    let turnIds: string[];
    try {
        const state = await sessions.getSession(sessionId);
        turnIds = state.turns.map((t) => t.turnId);
    } catch {
        return { sessionId: null, bubbles: [] };
    }

    const bubbles: TodoChatBubble[] = [];
    for (const turnId of turnIds) {
        try {
            const turn = await sessions.getTurn(turnId);
            const state = reduceTurn(turn.events);

            const userText = userBubbleText(messageText(state.definition.input.content));
            if (userText) bubbles.push({ role: 'user', text: userText, links: [] });

            const links = state.toolCalls
                .filter((t) => t.toolName === 'todo-report')
                .flatMap((t) => reportLinks(t.input));

            const terminal = state.terminal;
            if (!terminal) continue; // in flight — the spinner covers it
            if (terminal.type === 'turn_completed') {
                const text = assistantText(terminal.output);
                if (text || links.length > 0) {
                    bubbles.push({ role: 'rowboat', text: text ?? '', links });
                }
            } else if (terminal.type === 'turn_failed') {
                // First line only — provider errors can be multi-line JSON.
                const error = terminal.error.split('\n')[0].slice(0, 300);
                bubbles.push({ role: 'rowboat', text: error, kind: 'error', links: [] });
            } else {
                bubbles.push({ role: 'rowboat', text: 'Stopped.', kind: 'error', links: [] });
            }
        } catch (err) {
            // One corrupt turn must not hide the rest of the conversation.
            log.log(`skipping unreadable turn ${turnId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { sessionId, bubbles };
}
