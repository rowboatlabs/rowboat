import type { ToolCallContent } from '@agentclientprotocol/sdk';

/** Keep command output and edit previews without persisting arbitrary protocol
 * metadata. Cap oversized output explicitly rather than dropping all content. */
export function toolDetail(content?: ToolCallContent[] | null, input?: unknown) {
    const output = (content ?? []).flatMap(c => c.type === 'content' && c.content.type === 'text' ? [c.content.text] : []).join('\n');
    const edits = (content ?? []).flatMap(c => c.type === 'diff' ? [{ path: c.path, oldText: c.oldText ?? null, newText: c.newText }] : []);
    return {
        ...(input && typeof input === 'object' && 'command' in input && typeof input.command === 'string' ? { command: input.command } : {}),
        ...(output ? { output: output.length > 65_536 ? output.slice(0, 65_536) + '\n[Output truncated at 64 KiB]' : output } : {}),
        ...(edits.length ? { edits } : {}),
    };
}
