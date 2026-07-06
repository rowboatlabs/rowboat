import { z } from 'zod';

// Rowboat Apps schemas (spec §4.2, §5.1, §9.1, §11.4, §12.2).

export const PACKAGE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// ---------------------------------------------------------------------------
// Manifest — rowboat-app.json (§4.2)
// ---------------------------------------------------------------------------

export const RowboatAppManifestSchema = z.object({
    schemaVersion: z.literal(1),
    name: z.string().min(3).max(64).regex(PACKAGE_NAME_RE)
        .describe('Package identity. Globally unique and immutable once published.'),
    version: z.string().regex(SEMVER_RE)
        .describe('Strict semver, no prerelease/build suffix in V1.'),
    description: z.string().max(500).default(''),
    icon: z.string().optional()
        .describe('Path relative to dist/. Same traversal rules as entry.'),
    entry: z.string().default('index.html')
        .describe('Path relative to dist/. Serves as app root and SPA fallback.'),
    agents: z.array(z.string().regex(/^[a-z0-9][a-z0-9-_]*\.yaml$/)).default([])
        .describe('Filenames under agents/. Each must exist in the package.'),
    capabilities: z.array(z.string()).default([])
        .describe('Capability identifiers this app may use (D7): Composio toolkit slugs for /_rowboat/tools/*, plus the reserved identifiers "llm" (§7.6) and "copilot" (§7.7). Empty = none.'),
    dataContracts: z.array(z.object({
        file: z.string(), // path relative to data/, e.g. "data.json"
        requiredKeys: z.array(z.string()).default([]),
        nonEmptyArrayKeys: z.array(z.string()).default([]),
    })).default([])
        .describe('Write guards for specific data/ files: required top-level keys and keys that must stay non-empty arrays. Enforced on writes (§7.3, §8.6) so a buggy agent run cannot corrupt the app\'s data shape or wipe good series with empties.'),
    // RESERVED — validated if present, ignored by V1 runtime:
    build: z.object({ command: z.string() }).optional()
        .describe('RESERVED. Rowboat MUST NOT execute this in V1.'),
    minRowboatVersion: z.string().regex(SEMVER_RE).optional()
        .describe('RESERVED. Minimum compatible Rowboat version; not enforced in V1.'),
}).passthrough(); // unknown fields survive round-trips (forward compatibility)

export type RowboatAppManifest = z.infer<typeof RowboatAppManifestSchema>;

// ---------------------------------------------------------------------------
// Install record — .rowboat-install.json (§12.2)
// ---------------------------------------------------------------------------

export const AppInstallRecordSchema = z.object({
    name: z.string(),
    repo: z.string().optional(), // owner/repo at install time; absent only for non-GitHub URL installs (§12.5)
    sourceUrl: z.string().optional(), // present only for §12.5 URL installs
    version: z.string(),
    sha256: z.string(), // bundle checksum, pinned at install
    installedAt: z.string(),
    updatedAt: z.string().optional(),
    files: z.record(z.string(), z.string()), // relpath → sha256 of release-managed files
    previousVersion: z.string().optional(), // set while .previous/ exists
});

export type AppInstallRecord = z.infer<typeof AppInstallRecordSchema>;

// ---------------------------------------------------------------------------
// Publish record — .rowboat-publish.json (§11.4)
// ---------------------------------------------------------------------------

export const AppPublishRecordSchema = z.object({
    name: z.string(),
    login: z.string(), // publisher GitHub login
    repo: z.string(), // owner/repo
    lastPublishedVersion: z.string().optional(),
    lastSha256: z.string().optional(),
    pendingSteps: z.object({ // present only mid-publish (resume state)
        version: z.string(),
        completed: z.array(z.string()), // step names from §11.2
        releaseId: z.number().optional(),
        prUrl: z.string().optional(),
    }).optional(),
});

export type AppPublishRecord = z.infer<typeof AppPublishRecordSchema>;

// ---------------------------------------------------------------------------
// App summary — apps:list / apps:get (§5.1)
// ---------------------------------------------------------------------------

export const AppSummarySchema = z.object({
    folder: z.string(), // folder slug
    status: z.enum(['ok', 'invalid']),
    manifest: RowboatAppManifestSchema.optional(), // present when ok
    manifestError: z.string().optional(), // present when invalid
    origin: z.string(), // http://<folder>.apps.localhost:3210
    kind: z.enum(['local', 'installed']),
    install: AppInstallRecordSchema.optional(), // §12.2
    publish: AppPublishRecordSchema.optional(), // §11.4
    hasDist: z.boolean(),
    agentSlugs: z.array(z.string()), // materialized bg-task slugs (§8.3)
});

export type AppSummary = z.infer<typeof AppSummarySchema>;

// ---------------------------------------------------------------------------
// Registry record — apps/<name>.json in the registry repo (§9.1)
// ---------------------------------------------------------------------------

export const RegistryRecordSchema = z.object({
    schemaVersion: z.literal(1),
    name: z.string().min(3).max(64).regex(PACKAGE_NAME_RE),
    owner: z.string().min(1), // GitHub login of the publisher
    repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), // "owner/repo"
    description: z.string().max(500).default(''),
    iconUrl: z.string().url().optional(), // https URL for the catalog listing icon
    createdAt: z.string(), // ISO 8601
}).strict();

export type RegistryRecord = z.infer<typeof RegistryRecordSchema>;
