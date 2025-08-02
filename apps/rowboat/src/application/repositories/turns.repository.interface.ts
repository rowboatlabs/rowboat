import { Turn } from "@/src/entities/models/turn";
import { z } from "zod";

export const CreateTurnData = Turn.omit({
    id: true,
    createdAt: true,
    lastUpdatedAt: true,
    status: true,
    error: true,
});

export const UpdateTurnData = Turn.pick({
    status: true,
    error: true,
});

export const AddMessagesData = Turn.pick({
    messages: true,
});

export interface ITurnsRepository {
    // create a new turn
    createTurn(data: z.infer<typeof CreateTurnData>): Promise<z.infer<typeof Turn>>;

    // get a turn by id
    getTurn(id: string): Promise<z.infer<typeof Turn> | null>;

    // append messages to turn
    addMessages(id: string, data: z.infer<typeof AddMessagesData>): Promise<z.infer<typeof Turn>>;

    // save turn data
    saveTurn(id: string, data: z.infer<typeof UpdateTurnData>): Promise<z.infer<typeof Turn>>;

    // poll turns and acquire lock on a pending turn
    pollTurns(workerId: string): Promise<z.infer<typeof Turn> | null>;

    // acquire lock on a specific turn
    lockTurn(runId: string, workerId: string): Promise<z.infer<typeof Turn> | null>;

    // release lock on turn
    releaseTurn(runId: string): Promise<boolean>;
}