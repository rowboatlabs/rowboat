import type { z } from "zod";
import {
    type RequestedAgent,
    type ResolvedAgent,
    isInlineAgentRequest,
} from "@x/shared/dist/turns.js";
import type { IAgentResolver } from "../agent-resolver.js";
import type { InlineAgentResolver } from "./inline-agent-resolver.js";
import type { RealAgentResolver } from "./real-agent-resolver.js";

// The only IAgentResolver implementation: narrows the RequestedAgent union
// exactly once and hands each variant to a resolver that never sees the
// other's concerns (loadAgent/composition vs. catalog validation/defaults).
export class DispatchingAgentResolver implements IAgentResolver {
    constructor(
        private readonly byId: RealAgentResolver,
        private readonly inline: InlineAgentResolver,
    ) {}

    resolve(
        requested: z.infer<typeof RequestedAgent>,
    ): Promise<z.infer<typeof ResolvedAgent>> {
        return isInlineAgentRequest(requested)
            ? this.inline.resolve(requested)
            : this.byId.resolve(requested);
    }
}
