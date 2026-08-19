// Ghostwriter: paste assistant-authored text at the user's cursor in
// WHATEVER app they're looking at. The interface lives in core so the
// paste-at-cursor builtin can resolve it; the implementation is the app
// layer's (Electron main — clipboard + synthesized ⌘V), registered via
// registerTextInsertService like the other platform services.

export interface TextInsertResult {
    ok: boolean;
    /** The app the text landed in (its display name), when known. */
    app?: string;
    error?: string;
}

export interface ITextInsertService {
    /** Platform support (macOS only for now). */
    isSupported(): boolean;
    /**
     * Remember the frontmost non-Rowboat app as the paste target. Called at
     * the moments the user's intent is legible — companion summon, the
     * paste chord — BEFORE any window focus can shift.
     */
    captureTarget(): Promise<void>;
    /**
     * Paste `text` at the cursor of the target app: preserve the clipboard,
     * re-activate the target, synthesize ⌘V, restore the clipboard. Never
     * presses anything beyond the paste — submitting stays the user's act.
     */
    insert(text: string): Promise<TextInsertResult>;
}
