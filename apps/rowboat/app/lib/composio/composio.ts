import { z } from "zod";
import { PrefixLogger } from "../utils";
import { Composio } from "@composio/core";

const BASE_URL = 'https://backend.composio.dev/api/v3';
const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY || "";
export const composio = new Composio();

export const ZAuthScheme = z.enum([
    'API_KEY',
    'BASIC',
    'BASIC_WITH_JWT',
    'BEARER_TOKEN',
    'BILLCOM_AUTH',
    'CALCOM_AUTH',
    'COMPOSIO_LINK',
    'GOOGLE_SERVICE_ACCOUNT',
    'NO_AUTH',
    'OAUTH1',
    'OAUTH2',
]);

export const ZConnectedAccountStatus = z.enum([
    'INITIALIZING',
    'INITIATED',
    'ACTIVE',
    'FAILED',
    'EXPIRED',
    'INACTIVE',
]);

export const ZToolkit = z.object({
    slug: z.string(),
    name: z.string(),
    meta: z.object({
        description: z.string(),
        logo: z.string(),
        tools_count: z.number(),
        triggers_count: z.number(),
    }),
    no_auth: z.boolean(),
    auth_schemes: z.array(ZAuthScheme),
    composio_managed_auth_schemes: z.array(ZAuthScheme),
});

export const ZComposioField = z.object({
    name: z.string(),
    displayName: z.string(),
    type: z.string(),
    description: z.string(),
    required: z.boolean(),
    default: z.string().nullable().optional(),
});

export const ZGetToolkitResponse = z.object({
    slug: z.string(),
    name: z.string(),
    composio_managed_auth_schemes: z.array(ZAuthScheme),
    auth_config_details: z.array(z.object({
        name: z.string(),
        mode: ZAuthScheme,
        fields: z.object({
            auth_config_creation: z.object({
                required: z.array(ZComposioField),
                optional: z.array(ZComposioField),
            }),
            connected_account_initiation: z.object({
                required: z.array(ZComposioField),
                optional: z.array(ZComposioField),
            }),
        })
    })).nullable(),
});

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
        properties: z.record(z.string(), z.any()),
        required: z.array(z.string()).optional(),
        additionalProperties: z.boolean().optional(),
    }),
    no_auth: z.boolean(),
});


export const ZAuthConfig = z.object({
    id: z.string(),
    is_composio_managed: z.boolean(),
    auth_scheme: ZAuthScheme,
});

export const ZCredentials = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const ZCreateAuthConfigRequest = z.object({
    toolkit: z.object({
        slug: z.string(),
    }),
    auth_config: z.discriminatedUnion('type', [
        z.object({
            type: z.literal('use_composio_managed_auth'),
            name: z.string().optional(),
            credentials: ZCredentials.optional(),
            restrict_to_following_tools: z.array(z.string()).optional(),
        }),
        z.object({
            type: z.literal('use_custom_auth'),
            authScheme: ZAuthScheme,
            credentials: ZCredentials,
            name: z.string().optional(),
            proxy_config: z.object({
                proxy_url: z.string(),
                proxy_auth_key: z.string().optional(),
            }).optional(),
            restrict_to_following_tools: z.array(z.string()).optional(),
        }),
    ]).optional(),
});

/*
{
    "toolkit": {
        "slug": "github"
    },
    "auth_config": {
        "id": "ac_ZiLwFAWuGA7G",
        "auth_scheme": "OAUTH2",
        "is_composio_managed": false,
        "restrict_to_following_tools": []
    }
}
*/
export const ZCreateAuthConfigResponse = z.object({
    toolkit: z.object({
        slug: z.string(),
    }),
    auth_config: ZAuthConfig,
});

const ZConnectionData = z.object({
    authScheme: ZAuthScheme,
    val: z.record(z.string(), z.unknown())
        .and(z.object({
            status: ZConnectedAccountStatus,
        })),
});

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

/*
{
    "id": "ca_vTkCeLZSGab-",
    "connectionData": {
        "authScheme": "OAUTH2",
        "val": {
            "status": "INITIATED",
            "code_verifier": "cd0103c5d8836a387adab1635b65ff0d2f51f77a1a79b7ff",
            "redirectUrl": "https://backend.composio.dev/api/v3/s/DbTOWAyR",
            "callback_url": "https://backend.composio.dev/api/v1/auth-apps/add"
        }
    },
    "status": "INITIATED",
    "redirect_url": "https://backend.composio.dev/api/v3/s/DbTOWAyR",
    "redirect_uri": "https://backend.composio.dev/api/v3/s/DbTOWAyR",
    "deprecated": {
        "uuid": "fe66d24b-59d8-4abf-adb2-d8f74353da9e",
        "authConfigUuid": "8c4d4c84-56e2-4a80-aa59-9e84503381d8"
    }
}
*/
export const ZCreateConnectedAccountResponse = z.object({
    id: z.string(),
    connectionData: ZConnectionData,
});

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

const ZErrorResponse = z.object({
    error: z.object({
        message: z.string(),
        error_code: z.number(),
        suggested_fix: z.string().nullable(),
        errors: z.array(z.string()).nullable(),
    }),
});

export const ZError = z.object({
    error: z.enum([
        'CUSTOM_OAUTH2_CONFIG_REQUIRED',
    ]),
});

export const ZDeleteOperationResponse = z.object({
    success: z.boolean(),
});

export const ZTriggerType = z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    toolkit: z.object({
        slug: z.string(),
        name: z.string(),
        logo: z.string(),
    }),
    config: z.object({
        type: z.literal('object'),
        properties: z.record(z.string(), z.any()),
        required: z.array(z.string()).optional(),
        title: z.string().optional(),
    }),
});

export const ZListResponse = <T extends z.ZodTypeAny>(schema: T) => z.object({
    items: z.array(schema),
    next_cursor: z.string().nullable(),
    total_pages: z.number(),
    current_page: z.number(),
    total_items: z.number(),
});

export async function composioApiCall<T extends z.ZodTypeAny>(
    schema: T,
    url: string,
    options: RequestInit = {},
): Promise<z.infer<T>> {
    const logger = new PrefixLogger('composioApiCall');
    logger.log(`[${options.method || 'GET'}] ${url}`, options);

    const then = Date.now();

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                "x-api-key": COMPOSIO_API_KEY,
                ...(options.method === 'POST' ? {
                    "Content-Type": "application/json",
                } : {}),
            },
        });
        const duration = Date.now() - then;
        logger.log(`Took: ${duration}ms`);
        const data = await response.json();
        if ('error' in data) {
            const response = ZErrorResponse.parse(data);
            throw new Error(`(code: ${response.error.error_code}): ${response.error.message}: ${response.error.suggested_fix}: ${response.error.errors?.join(', ')}`);
        }
        return schema.parse(data);
    } catch (error) {
        logger.log(`Error:`, error);
        throw error;
    }
}

export async function listToolkits(cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
    const url = new URL(`${BASE_URL}/toolkits`);

    // set params
    url.searchParams.set("sort_by", "usage");
    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }

    // fetch
    return composioApiCall(ZListResponse(ZToolkit), url.toString());
}

export async function getToolkit(toolkitSlug: string): Promise<z.infer<typeof ZGetToolkitResponse>> {
    const url = new URL(`${BASE_URL}/toolkits/${toolkitSlug}`);
    return composioApiCall(ZGetToolkitResponse, url.toString());
}

export async function listTools(toolkitSlug: string, searchQuery: string | null = null, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    const url = new URL(`${BASE_URL}/tools`);

    // set params
    url.searchParams.set("toolkit_slug", toolkitSlug);
    if (searchQuery) {
        url.searchParams.set("search", searchQuery);
    }
    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }

    // fetch
    return composioApiCall(ZListResponse(ZTool), url.toString());
}

export async function getTool(toolSlug: string): Promise<z.infer<typeof ZTool>> {
    const url = new URL(`${BASE_URL}/tools/${toolSlug}`);
    return composioApiCall(ZTool, url.toString());
}

export async function listAuthConfigs(toolkitSlug: string, cursor: string | null = null, managedOnly: boolean = false): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZAuthConfig>>>> {
    const url = new URL(`${BASE_URL}/auth_configs`);
    url.searchParams.set("toolkit_slug", toolkitSlug);
    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }
    if (managedOnly) {
        url.searchParams.set("is_composio_managed", "true");
    }

    // fetch
    return composioApiCall(ZListResponse(ZAuthConfig), url.toString());
}

export async function createAuthConfig(request: z.infer<typeof ZCreateAuthConfigRequest>): Promise<z.infer<typeof ZCreateAuthConfigResponse>> {
    const url = new URL(`${BASE_URL}/auth_configs`);
    return composioApiCall(ZCreateAuthConfigResponse, url.toString(), {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

export async function getAuthConfig(authConfigId: string): Promise<z.infer<typeof ZAuthConfig>> {
    const url = new URL(`${BASE_URL}/auth_configs/${authConfigId}`);
    return composioApiCall(ZAuthConfig, url.toString());
}

export async function deleteAuthConfig(authConfigId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    const url = new URL(`${BASE_URL}/auth_configs/${authConfigId}`);
    return composioApiCall(ZDeleteOperationResponse, url.toString(), {
        method: 'DELETE',
    });
}

// export async function createComposioManagedOauth2AuthConfig(toolkitSlug: string): Promise<z.infer<typeof ZAuthConfig>> {
//     const response = await createAuthConfig({
//         toolkit: {
//             slug: toolkitSlug,
//         },
//         auth_config: {
//             type: 'use_composio_managed_auth',
//         },
//     });
//     return response.auth_config;
// }

// export async function autocreateOauth2Integration(toolkitSlug: string): Promise<z.infer<typeof ZAuthConfig | typeof ZError>> {
//     // fetch toolkit
//     const toolkit = await getToolkit(toolkitSlug);

//     // ensure oauth2 is supported
//     if (!toolkit.auth_config_details?.some(config => config.mode === 'OAUTH2')) {
//         throw new Error(`OAuth2 is not supported for toolkit ${toolkitSlug}`);
//     }

//     // fetch existing auth configs
//     const authConfigs = await fetchAuthConfigs(toolkitSlug);

//     // find a valid oauth2 config
//     const oauth2AuthConfig = authConfigs.items.find(config => config.auth_scheme === 'OAUTH2');

//     // if valid auth config, return it
//     if (oauth2AuthConfig) {
//         return oauth2AuthConfig;
//     }

//     // check if composio managed oauth2 is supported
//     if (toolkit.composio_managed_auth_schemes.includes('OAUTH2')) {
//         return await createComposioManagedOauth2AuthConfig(toolkitSlug);
//     }

//     // else return error
//     return {
//         error: 'CUSTOM_OAUTH2_CONFIG_REQUIRED',
//     };
// }

export async function createConnectedAccount(request: z.infer<typeof ZCreateConnectedAccountRequest>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    const url = new URL(`${BASE_URL}/connected_accounts`);
    return composioApiCall(ZCreateConnectedAccountResponse, url.toString(), {
        method: 'POST',
        body: JSON.stringify(request),
    });
}

// export async function createOauth2ConnectedAccount(toolkitSlug: string, userId: string, callbackUrl: string): Promise<z.infer<typeof ZCreateConnectedAccountResponse | typeof ZError>> {
//     // fetch auth config
//     const authConfig = await autocreateOauth2Integration(toolkitSlug);

//     // if error, return error
//     if ('error' in authConfig) {
//         return authConfig;
//     }

//     // create connected account
//     return await createConnectedAccount({
//         auth_config: {
//             id: authConfig.id,
//         },
//         connection: {
//             user_id: userId,
//             callback_url: callbackUrl,
//         },
//     });
// }

export async function getConnectedAccount(connectedAccountId: string): Promise<z.infer<typeof ZConnectedAccount>> {
    const url = new URL(`${BASE_URL}/connected_accounts/${connectedAccountId}`);
    return await composioApiCall(ZConnectedAccount, url.toString());
}

export async function deleteConnectedAccount(connectedAccountId: string): Promise<z.infer<typeof ZDeleteOperationResponse>> {
    const url = new URL(`${BASE_URL}/connected_accounts/${connectedAccountId}`);
    return await composioApiCall(ZDeleteOperationResponse, url.toString(), {
        method: 'DELETE',
    });
}

export async function listTriggersTypes(toolkitSlug: string, cursor?: string): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTriggerType>>>> {
    const url = new URL(`${BASE_URL}/triggers_types`);

    // set params
    url.searchParams.set("toolkit_slugs", toolkitSlug);
    if (cursor) {
        url.searchParams.set("cursor", cursor);
    }

    // fetch
    return composioApiCall(ZListResponse(ZTriggerType), url.toString());
}