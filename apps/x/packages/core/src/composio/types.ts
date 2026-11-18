import { z } from "zod";
import { ZToolkitMeta as ZSharedToolkitMeta, ZToolkitItem } from "@x/shared/dist/composio.js";

// Re-export the shared toolkit schemas so existing imports continue to work
export const ZToolkitMeta = ZSharedToolkitMeta;

/**
 * Composio authentication schemes
 */
export const ZAuthScheme = z.enum([
    'API_KEY',
    'BASIC',
    'BASIC_WITH_JWT',
    'BEARER_TOKEN',
    'COMPOSIO_LINK',
    'SERVICE_ACCOUNT',
    'GOOGLE_SERVICE_ACCOUNT',
    'NO_AUTH',
    'OAUTH1',
    'OAUTH2',
    'BILLCOM_AUTH',
    'CALCOM_AUTH',
    'SAML',
    'DCR_OAUTH',
    'CIMD_OAUTH',
    'S2S_OAUTH2',
]);

/**
 * Connected account status
 */
export const ZConnectedAccountStatus = z.enum([
    'INITIALIZING',
    'INITIATED',
    'ACTIVE',
    'FAILED',
    'EXPIRED',
    'INACTIVE',
    'REVOKED',
]);

/**
 * Toolkit schema — same shape as ZToolkitItem from shared, re-exported for convenience.
 */
export const ZToolkit = ZToolkitItem;

/**
 * Tool schema
 */
export const ZTool = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    toolkit: z.object({
        slug: z.string(),
        name: z.string(),
        logo: z.string(),
    }),
    input_parameters: z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), z.unknown()),
        required: z.array(z.string()).optional(),
        additionalProperties: z.boolean().optional(),
    }),
    no_auth: z.boolean().optional(),
});

/**
 * Auth config schema
 */
export const ZAuthConfig = z.object({
    id: z.string(),
    is_composio_managed: z.boolean(),
    auth_scheme: ZAuthScheme,
});

/**
 * Credentials schema
 */
export const ZCredentials = z.record(z.string(), z.unknown());

/**
 * Create auth config request
 */
export const ZCreateAuthConfigRequest = z.object({
    toolkit: z.object({
        slug: z.string(),
    }),
    auth_config: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('use_composio_managed_auth'),
            name: z.string().optional(),
            credentials: ZCredentials.optional(),
        }),
        z.object({
            type: z.literal('use_custom_auth'),
            authScheme: ZAuthScheme,
            credentials: ZCredentials,
            name: z.string().optional(),
        }),
    ]).optional(),
});

/**
 * Create auth config response
 */
export const ZCreateAuthConfigResponse = z.object({
    toolkit: z.object({
        slug: z.string(),
    }),
    auth_config: ZAuthConfig,
});

/**
 * Connection data schema
 */
export const ZConnectionData = z.object({
    authScheme: ZAuthScheme,
    val: z.record(z.string(), z.unknown()),
});

/**
 * Create connected account request
 */
export const ZCreateConnectedAccountRequest = z.object({
    auth_config: z.object({
        id: z.string(),
    }),
    connection: z.object({
        state: ZConnectionData.optional(),
        user_id: z.string().optional(),
        callback_url: z.string().optional(),
    }),
});

/**
 * Create connected account response
 */
export const ZCreateConnectedAccountResponse = z.object({
    id: z.string(),
    connectionData: ZConnectionData.optional(),
});

/**
 * Connected account schema
 */
export const ZConnectedAccount = z.object({
    id: z.string(),
    toolkit: z.object({
        slug: z.string(),
    }),
    auth_config: z.object({
        id: z.string(),
        is_composio_managed: z.boolean(),
        is_disabled: z.boolean(),
    }),
    status: ZConnectedAccountStatus,
});

/**
 * Error response schema
 */
export const ZErrorResponse = z.object({
    error: z.object({
        message: z.string(),
        code: z.union([z.number(), z.string()]).optional(),
        slug: z.string().optional(),
        status: z.number().optional(),
        request_id: z.string().optional(),
        error_code: z.number().optional(),
        suggested_fix: z.string().nullish(),
        suggestedFix: z.string().optional(),
        errors: z.array(z.string()).nullish(),
    }),
});

/**
 * Delete operation response
 */
export const ZDeleteOperationResponse = z.object({
    success: z.boolean(),
});

/**
 * Generic list response
 */
export const ZListResponse = <T extends z.ZodTypeAny>(schema: T) => z.object({
    items: z.array(schema),
    next_cursor: z.string().nullish().transform(value => value ?? null),
    total_pages: z.number(),
    current_page: z.number(),
    total_items: z.number(),
});

/**
 * Execute action request
 */
export const ZExecuteActionRequest = z.object({
    connected_account_id: z.string().min(1).optional(),
    user_id: z.string().optional(),
    version: z.string().min(1).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Execute action response
 */
export const ZExecuteActionResponse = z.object({
    data: z.unknown(),
    successful: z.boolean(),
    error: z.string().nullable(),
});

/**
 * Local connected account storage schema
 */
export const ZLocalConnectedAccount = z.object({
    id: z.string(),
    authConfigId: z.string(),
    status: ZConnectedAccountStatus,
    toolkitSlug: z.string(),
    createdAt: z.string(),
    lastUpdatedAt: z.string(),
});

export type Toolkit = z.infer<typeof ZToolkit>;
export type LocalConnectedAccount = z.infer<typeof ZLocalConnectedAccount>;
export type ConnectedAccountStatus = z.infer<typeof ZConnectedAccountStatus>;

/**
 * Tool schema for search results.
 * Unlike ZTool, `toolkit` is optional because the Composio /tools search endpoint
 * sometimes omits the toolkit object from results. `input_parameters` uses
 * lenient defaults so tools with no params (e.g. LINKEDIN_GET_MY_INFO) parse cleanly.
 */
export const ZSearchResultTool = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    toolkit: z.object({
        slug: z.string(),
        name: z.string(),
        logo: z.string(),
    }),
    input_parameters: z.object({
        type: z.literal('object').optional().default('object'),
        properties: z.record(z.string(), z.unknown()).optional().default({}),
        required: z.array(z.string()).optional(),
    }).optional().default({ type: 'object', properties: {} }),
}).passthrough();

/**
 * Normalized tool result returned from searchTools().
 */
export const ZNormalizedToolResult = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    toolkitSlug: z.string(),
    inputParameters: z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), z.unknown()),
        required: z.array(z.string()).optional(),
    }),
});
export type NormalizedToolResult = z.infer<typeof ZNormalizedToolResult>;

// 2026-11-11: managed OAuth uses Composio's hosted /link contract.
export const ZLinkConnectedAccountRequest = z.object({
    auth_config_id: z.string(),
    user_id: z.string(),
    callback_url: z.url().optional(),
    alias: z.string().optional(),
    connection_data: z.record(z.string(), z.unknown()).optional(),
});

export const ZLinkConnectedAccountResponse = z.object({
    link_token: z.string(),
    redirect_url: z.url(),
    expires_at: z.string(),
    connected_account_id: z.string(),
});
