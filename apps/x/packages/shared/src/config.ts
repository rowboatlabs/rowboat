import { z } from "zod";
import { ExecutionProfile } from "./execution-profile.js";

export const AppConfig = z
    .object({
        executionProfile: ExecutionProfile,
    })
    .passthrough();

export type AppConfig = z.infer<typeof AppConfig>;
