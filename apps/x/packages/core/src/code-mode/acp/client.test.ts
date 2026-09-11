import { expect, it } from 'vitest';
import { extractModelOptions, toEvent } from './client.js';

it('keeps provider-qualified IDs, current values, grouped models and only advertised effort', () => {
    const options = extractModelOptions([
        { id: 'model', currentValue: 'provider/model', options: [{ name: 'Provider', options: [{ value: 'provider/model', name: 'Model' }] }] },
        { id: 'mode', currentValue: 'review', options: [{ value: 'review', name: 'Review' }] },
    ], undefined, true);
    expect(options).toEqual({ models: [{ value: 'provider/model', label: 'Model' }], efforts: [], modes: [{ value: 'review', label: 'Review' }], currentModel: 'provider/model', currentMode: 'review', currentEffort: undefined });
    expect(extractModelOptions([{ id: 'effort', currentValue: 'high', options: [{ value: 'high', name: 'High' }] }], undefined, true).efforts).toEqual([{ value: 'high', label: 'High' }]);
});

it('preserves command failures, output, edit previews and late tool titles', () => {
    const event = toEvent({ sessionUpdate: 'tool_call_update', toolCallId: 'command', title: 'Run tests', kind: 'execute', status: 'failed', content: [
        { type: 'content', content: { type: 'text', text: 'FAIL: expected true, got false' } },
        { type: 'diff', path: '/project/app.ts', oldText: 'before', newText: 'after' },
    ] });
    expect(event).toMatchObject({ type: 'tool_call_update', title: 'Run tests', status: 'failed', diffs: ['/project/app.ts'], detail: { output: 'FAIL: expected true, got false', edits: [{ path: '/project/app.ts', oldText: 'before', newText: 'after' }] } });
});
