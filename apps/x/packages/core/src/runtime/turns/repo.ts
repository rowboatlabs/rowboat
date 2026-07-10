import type { z } from "zod";
import type { TurnCreated, TurnEvent } from "@x/shared/dist/turns.js";

// Loop-facing repository contract. Listing, deletion, session lookup, and
// presentation metadata are deliberately not part of it.
export interface ITurnRepo {
    // Fails if the turn already exists.
    create(event: z.infer<typeof TurnCreated>): Promise<void>;
    // Validates every line strictly; corrupt files are rejected whole.
    read(turnId: string): Promise<Array<z.infer<typeof TurnEvent>>>;
    // Validates events before writing.
    append(turnId: string, events: Array<z.infer<typeof TurnEvent>>): Promise<void>;
    // In-process per-turn exclusion.
    withLock<T>(turnId: string, fn: () => Promise<T>): Promise<T>;
}
