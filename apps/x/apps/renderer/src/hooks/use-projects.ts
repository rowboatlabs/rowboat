import { useEffect, useSyncExternalStore } from 'react';
import type { ipc } from '@x/shared';

export type Project = ipc.IPCChannels['projects:list']['res']['projects'][number];
let state: { projects: Project[]; ready: boolean; error?: string } = { projects: [], ready: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let consumers = 0;
let stop: (() => void) | undefined;
export function refreshProjects(): Promise<void> {
    if (loading) return loading;
    loading = window.ipc.invoke('projects:list', null).then(({ projects }) => {
        state = { projects, ready: true };
    }, (error: unknown) => {
        state = { ...state, ready: true, error: error instanceof Error ? error.message : 'Could not load projects' };
    }).finally(() => { loading = null; listeners.forEach((fn) => fn()); });
    return loading;
}
export function useProjects() {
    const snapshot = useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
    useEffect(() => {
        if (consumers++ === 0) {
            void refreshProjects();
            let debounce: ReturnType<typeof setTimeout> | undefined;
            const schedule = () => {
                if (debounce) clearTimeout(debounce);
                debounce = setTimeout(() => { void refreshProjects(); }, 150);
            };
            const offSessions = window.ipc.on('sessions:events', schedule);
            const offFiles = window.ipc.on('workspace:didChange', schedule);
            // Catch external filesystem edits and older clients without events.
            const timer = window.setInterval(() => { void refreshProjects(); }, 15000);
            stop = () => { offSessions(); offFiles(); clearTimeout(debounce); window.clearInterval(timer); };
        }
        return () => { if (--consumers === 0) { stop?.(); stop = undefined; } };
    }, []);
    return { ...snapshot, refresh: refreshProjects };
}
