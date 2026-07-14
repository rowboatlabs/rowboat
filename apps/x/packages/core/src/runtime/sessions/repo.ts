import type { z } from "zod";
import type { SessionCreated, SessionEvent } from "@x/shared/dist/sessions.js";

export interface ISessionRepo {
    // Fails if the session already exists.
    create(event: z.infer<typeof SessionCreated>): Promise<void>;
    // Validates every line strictly; corrupt files are rejected whole.
    read(sessionId: string): Promise<Array<z.infer<typeof SessionEvent>>>;
    // Validates events before writing.
    append(
        sessionId: string,
        events: Array<z.infer<typeof SessionEvent>>,
    ): Promise<void>;
    // In-process per-session exclusion.
    withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
    // Enumerates all session ids for the startup scan.
    listSessionIds(): Promise<string[]>;
    // Removes the session file only; referenced turn files stay as orphans.
    delete(sessionId: string): Promise<void>;
}
