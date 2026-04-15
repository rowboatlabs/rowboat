import z from "zod";

import { RunEvent } from "../entities/run-events.js";

export const Run = z.object({
    id: z.string(),
    createdAt: z.iso.datetime(),
    agentId: z.string(),
    log: z.array(RunEvent),
});
