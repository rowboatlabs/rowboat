// The builtin-tool catalog schema: every entry is {description, inputSchema,
// execute, isAvailable?}. Shared typing for the domain modules and the
// merged catalog.

import { z, ZodType } from "zod";

export const BuiltinToolsSchema = z.record(z.string(), z.object({
    description: z.string(),
	inputSchema: z.custom<ZodType>(),
    execute: z.function({
        input: z.any(), // (input, ctx?) => Promise<any>
        output: z.promise(z.any()),
    }),
    isAvailable: z.custom<() => Promise<boolean>>().optional(),
}));
