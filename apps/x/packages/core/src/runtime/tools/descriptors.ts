import { z } from "zod";
import type { JsonValue, ToolDescriptor } from "@x/shared/dist/turns.js";
import type { BuiltinTools } from "./catalog.js";

type BuiltinToolDef = (typeof BuiltinTools)[string];

// The one place a builtin catalog entry becomes a persisted ToolDescriptor.
// Shared by the by-id and inline agent resolvers so both produce
// byte-identical descriptors (which is what makes agent-snapshot inheritance
// work across turns).
export function builtinToolDescriptor(
    name: string,
    builtin: BuiltinToolDef,
): z.infer<typeof ToolDescriptor> {
    return {
        toolId: `builtin:${name}`,
        name,
        description: builtin.description,
        inputSchema: toJsonSchema(builtin.inputSchema),
        execution: "sync",
        requiresHuman: false,
    };
}

export function toJsonSchema(schema: unknown): JsonValue {
    try {
        return toJsonValue(z.toJSONSchema(schema as z.ZodType)) ?? {
            type: "object",
            properties: {},
        };
    } catch {
        // An exotic zod schema must not break the whole turn.
        return { type: "object", properties: {} };
    }
}

export function toJsonValue(value: unknown): JsonValue | undefined {
    try {
        return JSON.parse(JSON.stringify(value)) as JsonValue;
    } catch {
        return undefined;
    }
}
