import type { CodeSession } from '@x/shared/dist/code-sessions.js';

// Null actively clears a stale caller's Code selection, while cwd stays pinned.
// Legacy sessions without the preference keep coding enabled.
export function projectSessionComposition(session: CodeSession) {
    return { codeMode: session.codeModeEnabled === false ? null : session.agent, codeCwd: session.cwd };
}
