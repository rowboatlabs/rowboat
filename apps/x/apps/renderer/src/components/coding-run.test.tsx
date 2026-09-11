import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CodeRunPermissionRequest, reduceEvents } from './coding-run';

afterEach(cleanup);
it('shows OpenCode command details and hides unsupported persistent approval', () => {
    const onDecide = vi.fn();
    render(<CodeRunPermissionRequest ask={{ title: 'Run tests', kind: 'execute', isRead: false, allowAlways: false, detail: { command: 'npm test' } }} onDecide={onDecide} />);
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull();
    expect(screen.getByText('npm test')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDecide).toHaveBeenCalledWith('reject');
});

it('retains failed command output and edit previews through late updates', () => {
    const rows = reduceEvents([
        { type: 'tool_call', id: 't', title: 'Pending', kind: 'execute', status: 'pending', detail: { command: 'npm test' } },
        { type: 'tool_call_update', id: 't', title: 'Run tests', status: 'failed', diffs: ['/project/a'], detail: { output: 'test failed', edits: [{ path: '/project/a', oldText: 'old', newText: 'new' }] } },
    ]);
    expect(rows).toEqual([{ kind: 'tool', id: 't', title: 'Run tests', toolKind: 'execute', status: 'failed', diffs: ['/project/a'], detail: { command: 'npm test', output: 'test failed', edits: [{ path: '/project/a', oldText: 'old', newText: 'new' }] } }]);
});
