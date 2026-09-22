import { ProfileId, composioAuthConfigName } from "../config/profile.js";

/** Structural view of a listed auth config (only the fields selection needs). */
export interface ManagedAuthConfigLike {
    id: string;
    name?: string;
    auth_scheme?: string;
    is_composio_managed?: boolean;
}

/**
 * Pick this profile's managed OAUTH2 auth config. Prefers the exact
 * per-profile config; otherwise reuses any managed OAUTH2 config for the
 * toolkit.
 *
 * Composio permits only ONE managed auth config per toolkit per project, so a
 * second profile cannot create its own — creating one returns
 * `400 Managed auth already exists`. Reusing the project-wide config is correct:
 * per-profile separation lives in the connected account's `user_id`
 * (composioUserId), not in the shared OAuth app config.
 */
export function selectManagedAuthConfig(
    items: ManagedAuthConfigLike[],
    toolkitSlug: string,
    profileId: string = ProfileId,
): string | null {
    const managed = items.filter(
        (cfg) => cfg.auth_scheme === "OAUTH2" && cfg.is_composio_managed === true,
    );
    const expected = composioAuthConfigName(toolkitSlug, profileId);
    const own = managed.find((cfg) => cfg.name === expected);
    if (own) return own.id;
    return managed[0]?.id ?? null;
}
