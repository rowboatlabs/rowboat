import { Message } from "@/app/lib/types/types";
import { Run } from "./run";
import { z } from "zod";

export const RunEvent = z.union([
    z.object({
        type: z.literal("message"),
        data: Message,
    }),
    z.object({
        type: z.literal("error"),
        error: z.string(),
    }),
    z.object({
        type: z.literal("done"),
        run: Run,
    }),
]);
