// Builtin tools: models domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import { getDefaultModelAndProvider } from "../../../models/defaults.js";
import { listGatewayModels } from "../../../models/gateway.js";
import { isSignedIn } from "../../../account/account.js";
import { BuiltinToolsSchema } from "../types.js";


export const modelTools: z.infer<typeof BuiltinToolsSchema> = {
    'list-models': {
        permission: "none",
        description: "List model IDs available for model overrides (e.g. to set a capable model on a background task). Signed-in users get the Rowboat gateway's allowed models; BYOK users get their configured model. Call this BEFORE setting a bg-task `model` so you pick a valid, allowed ID (arbitrary IDs are rejected). Returns { defaultModel, models }.",
        inputSchema: z.object({}),
        execute: async () => {
            try {
                if (await isSignedIn()) {
                    const { providers } = await listGatewayModels();
                    const models = providers.flatMap((p) => p.models.map((m) => m.id));
                    const { model: defaultModel } = await getDefaultModelAndProvider();
                    return { signedIn: true, defaultModel, models };
                }
                const { model, provider } = await getDefaultModelAndProvider();
                return { signedIn: false, defaultModel: model, provider, models: [model] };
            } catch (e) {
                return { error: e instanceof Error ? e.message : String(e) };
            }
        },
        isAvailable: async () => true,
    },
};
