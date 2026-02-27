import z from "zod";

export const SlackWorkspace = z.object({
    url: z.string(),
    name: z.string(),
});
export type SlackWorkspace = z.infer<typeof SlackWorkspace>;

export const SlackConfig = z.object({
    enabled: z.boolean(),
    workspaces: z.array(SlackWorkspace).default([]),
});
export type SlackConfig = z.infer<typeof SlackConfig>;
