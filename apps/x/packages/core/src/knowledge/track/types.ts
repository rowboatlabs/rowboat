import z from "zod";
import { TrackBlockSchema } from "@x/shared/dist/track-block.js";

export const TrackStateSchema = z.object({
    track: TrackBlockSchema,
    fenceStart: z.number(),
    fenceEnd: z.number(),
    content: z.string(),
});