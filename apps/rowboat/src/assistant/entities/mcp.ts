import { z } from "zod";

export const McpServer = z.object({
    id: z.string(),
    name: z.string(),
    serverUrl: z.string(),
    authType: z.enum(['none', 'bearer-token', 'oauth2']),
    authCredentialId: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});