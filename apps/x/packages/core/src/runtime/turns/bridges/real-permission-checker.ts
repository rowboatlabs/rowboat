import type { JsonValue } from "@x/shared/dist/turns.js";
import { getToolPermissionMetadata } from "../../assembly/permission-metadata.js";
import type {
    IPermissionChecker,
    PermissionCheckAllowed,
    PermissionCheckInput,
    PermissionCheckRequired,
} from "../permission.js";

export interface RealPermissionCheckerDeps {
    getMetadata?: typeof getToolPermissionMetadata;
}

// Bridges the existing deterministic permission rules: only builtins are
// gated (executeCommand via the command allowlist, file tools via workspace
// boundaries and file-access grants). Session-scoped grants are deferred, so
// the session grant inputs are always empty. A thrown metadata error
// propagates: the turn loop fails closed on checker errors.
export class RealPermissionChecker implements IPermissionChecker {
    private readonly getMetadata: typeof getToolPermissionMetadata;

    constructor(deps: RealPermissionCheckerDeps = {}) {
        this.getMetadata = deps.getMetadata ?? getToolPermissionMetadata;
    }

    async check(
        input: PermissionCheckInput,
    ): Promise<PermissionCheckAllowed | PermissionCheckRequired> {
        if (!input.toolId.startsWith("builtin:")) {
            return { required: false };
        }
        const name = input.toolId.slice("builtin:".length);
        const metadata = await this.getMetadata(
            {
                type: "tool-call",
                toolCallId: input.toolCallId,
                toolName: input.toolName,
                arguments: input.input,
            },
            { type: "builtin", name },
            new Set<string>(), // session-scoped command grants: deferred
            [], // session-scoped file grants: deferred
        );
        if (!metadata) {
            return { required: false };
        }
        return { required: true, request: metadata as JsonValue };
    }
}
