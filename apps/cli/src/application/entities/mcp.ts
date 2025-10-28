import z from "zod";

export const McpServerConfig = z.object({
    mcpServers: z.array(z.object({
        name: z.string(),
        url: z.string(),
    })),
});