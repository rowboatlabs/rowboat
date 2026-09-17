import path from "node:path";

/**
 * First-party profiles (e.g. work vs personal).
 *
 * A profile is a short id that namespaces every piece of per-user identity
 * so two Rowboat instances on one machine are fully separate:
 * workdir, Composio user_id, auth-config names, and deep-link scheme.
 *
 * Resolution: ROWBOAT_PROFILE env var. Explicit ROWBOAT_WORKDIR still wins
 * for the workdir (see config.ts) but the profile id is used for identity
 * regardless. `default` preserves today's behavior byte-for-byte.
 */

export const DEFAULT_PROFILE_ID = "default";

const PROFILE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export function isValidProfileId(id: string): boolean {
    return PROFILE_ID_PATTERN.test(id);
}

/** Pure resolver, exported for unit testing. */
export function resolveProfileId(env: NodeJS.ProcessEnv = process.env): string {
    const raw = (env.ROWBOAT_PROFILE ?? "").trim().toLowerCase();
    if (!raw) return DEFAULT_PROFILE_ID;
    if (!isValidProfileId(raw)) {
        throw new Error(
            `Invalid ROWBOAT_PROFILE "${env.ROWBOAT_PROFILE}": use 1-32 lowercase letters, digits, or dashes.`,
        );
    }
    return raw;
}

/** The resolved profile for this process. */
export const ProfileId = resolveProfileId();

export function isDefaultProfile(id: string = ProfileId): boolean {
    return id === DEFAULT_PROFILE_ID;
}

/** Workdir for a profile. `default` keeps the historic ~/.rowboat. */
export function profileWorkDir(id: string, homeDir: string): string {
    if (isDefaultProfile(id)) return path.join(homeDir, ".rowboat");
    return path.join(homeDir, ".rowboat-profiles", id);
}

/**
 * Composio user_id for a profile. `default` keeps the historic
 * 'rowboat-user' so existing connected accounts keep working.
 */
export function composioUserId(id: string = ProfileId): string {
    if (isDefaultProfile(id)) return "rowboat-user";
    return `rowboat-user-${id}`;
}

/** Composio managed-auth config name for a toolkit under a profile. */
export function composioAuthConfigName(toolkitSlug: string, id: string = ProfileId): string {
    if (isDefaultProfile(id)) return `rowboat-${toolkitSlug}`;
    return `rowboat-${id}-${toolkitSlug}`;
}

/** OS deep-link scheme for a profile. `default` keeps `rowboat://`. */
export function deepLinkScheme(id: string = ProfileId): string {
    if (isDefaultProfile(id)) return "rowboat";
    return `rowboat-${id}`;
}

/** Build a deep-link URL for this profile, e.g. rowboat-work://open?... */
export function profileDeepLink(path: string, id: string = ProfileId): string {
    const clean = path.startsWith("/") ? path.slice(1) : path;
    return `${deepLinkScheme(id)}://${clean}`;
}

/** Stable 32-bit FNV-1a hash for deterministic per-profile port derivation. */
function fnv1a32(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export const DEFAULT_APPS_PORT = 3210;

/**
 * Default Apps-server port for a profile: the historic 3210 for `default`,
 * otherwise a stable derived port in 3211–3409 so two concurrent instances
 * never collide on bind. An explicit ROWBOAT_APPS_PORT still wins.
 */
export function defaultAppsPort(id: string = ProfileId): number {
    if (isDefaultProfile(id)) return DEFAULT_APPS_PORT;
    return DEFAULT_APPS_PORT + 1 + (fnv1a32(id) % 199);
}
