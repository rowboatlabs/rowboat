import z from "zod";

export const SlackConfig = z.object({
    enabled: z.boolean(),
});
export type SlackConfig = z.infer<typeof SlackConfig>;
