import { z } from "zod";

// NOTE: Some API responses may use the alias 'SERVICE_ACCOUNT'.
// Include it here for compatibility alongside the canonical 'GOOGLE_SERVICE_ACCOUNT'.
export const ZAuthScheme = z.enum([
    'API_KEY',
    'BASIC',
    'BASIC_WITH_JWT',
    'BEARER_TOKEN',
    'BILLCOM_AUTH',
    'CALCOM_AUTH',
    'COMPOSIO_LINK',
    'SERVICE_ACCOUNT',
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

export const ZToolkitMeta = z.object({
    description: z.string(),
    logo: z.string(),
    tools_count: z.number(),
    triggers_count: z.number(),
});

export const ZToolkit = z.object({
    slug: z.string(),
    name: z.string(),
    meta: ZToolkitMeta,
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
    meta: ZToolkitMeta,
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

export const ZConnectionData = z.object({
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

export const ZErrorResponse = z.object({
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
