import { ProfileId, composioAuthConfigName } from "../config/profile.js";

/** Structural view of a listed auth config (only the fields selection needs). */
export interface ManagedAuthConfigLike {
    id: string;
    name?: string;
    auth_scheme?: string;
    is_composio_managed?: boolean;
}

/**
 * Pick this profile's managed OAUTH2 auth config, or null when it must be
 * created. Never returns a foreign profile's config: exact per-profile name
 * match only.
 */
export function selectManagedAuthConfig(
    items: ManagedAuthConfigLike[],
    toolkitSlug: string,
    profileId: string = ProfileId,
): string | null {
    const expected = composioAuthConfigName(toolkitSlug, profileId);
    const hit = items.find(
        (cfg) =>
            cfg.auth_scheme === "OAUTH2" &&
            cfg.is_composio_managed === true &&
            cfg.name === expected,
    );
    return hit ? hit.id : null;
}
