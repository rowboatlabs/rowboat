"use server";
import { z } from "zod";
import {
    listToolkits as libListToolkits,
    listTools as libListTools,
    getConnectedAccount as libGetConnectedAccount,
    deleteConnectedAccount as libDeleteConnectedAccount,
    listAuthConfigs as libListAuthConfigs,
    createAuthConfig as libCreateAuthConfig,
    getToolkit as libGetToolkit,
    createConnectedAccount as libCreateConnectedAccount,
    getAuthConfig as libGetAuthConfig,
    deleteAuthConfig as libDeleteAuthConfig,
    ZToolkit,
    ZGetToolkitResponse,
    ZTool,
    ZListResponse,
    ZCreateConnectedAccountResponse,
    ZAuthScheme,
    ZCredentials,
} from "@/app/lib/composio/composio";
import { ComposioConnectedAccount, ComposioMockToolkitState } from "@/app/lib/types/project_types";
import { getProjectConfig, projectAuthCheck } from "./project_actions";
import { projectsCollection } from "../lib/mongodb";

const ZCreateCustomConnectedAccountRequest = z.object({
    toolkitSlug: z.string(),
    authConfig: z.object({
        authScheme: ZAuthScheme,
        credentials: ZCredentials,
    }),
    callbackUrl: z.string(),
});

export async function listToolkits(projectId: string, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
    await projectAuthCheck(projectId);
    return await libListToolkits(cursor);
}

export async function getToolkit(projectId: string, toolkitSlug: string): Promise<z.infer<typeof ZGetToolkitResponse>> {
    await projectAuthCheck(projectId);
    return await libGetToolkit(toolkitSlug);
}

export async function listTools(projectId: string, toolkitSlug: string, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    await projectAuthCheck(projectId);
    return await libListTools(toolkitSlug, cursor);
}

export async function createComposioManagedOauth2ConnectedAccount(projectId: string, toolkitSlug: string, callbackUrl: string): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    await projectAuthCheck(projectId);

    // fetch managed auth configs
    const configs = await libListAuthConfigs(toolkitSlug, null, true);

    // check if managed oauth2 config exists
    let authConfigId: string | undefined = undefined;
    const authConfig = configs.items.find(config => config.auth_scheme === 'OAUTH2' && config.is_composio_managed);
    authConfigId = authConfig?.id;
    if (!authConfig) {
        // create a new managed oauth2 auth config
        const newAuthConfig = await libCreateAuthConfig({
            toolkit: {
                slug: toolkitSlug,
            },
            auth_config: {
                type: 'use_composio_managed_auth',
                name: 'composio-managed-oauth2',
            },
        });
        authConfigId = newAuthConfig.auth_config.id;
    }
    if (!authConfigId) {
        throw new Error(`No managed oauth2 auth config found for toolkit ${toolkitSlug}`);
    }

    // create new connected account
    const response = await libCreateConnectedAccount({
        auth_config: {
            id: authConfigId,
        },
        connection: {
            user_id: projectId,
            callback_url: callbackUrl,
        },
    });

    // update project with new connected account
    const key = `composioConnectedAccounts.${toolkitSlug}`;
    const data: z.infer<typeof ComposioConnectedAccount> = {
        id: response.id,
        authConfigId: authConfigId,
        status: 'INITIATED',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    }
    await projectsCollection.updateOne({ _id: projectId }, { $set: { [key]: data } });

    return response;
}

export async function createCustomConnectedAccount(projectId: string, request: z.infer<typeof ZCreateCustomConnectedAccountRequest>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    await projectAuthCheck(projectId);

    // first, create the auth config
    const authConfig = await libCreateAuthConfig({
        toolkit: {
            slug: request.toolkitSlug,
        },
        auth_config: {
            type: 'use_custom_auth',
            authScheme: request.authConfig.authScheme,
            credentials: request.authConfig.credentials,
            name: `pid-${projectId}-${Date.now()}`,
        },
    });

    // then, create the connected account
    let state = undefined;
    if (request.authConfig.authScheme !== 'OAUTH2') {
        state = {
            authScheme: request.authConfig.authScheme,
            val: {
                status: 'ACTIVE' as const,
                ...request.authConfig.credentials,
            },
        };
    }
    const response = await libCreateConnectedAccount({
        auth_config: {
            id: authConfig.auth_config.id,
        },
        connection: {
            state,
            user_id: projectId,
            callback_url: request.callbackUrl,
        },
    });

    // update project with new connected account
    const key = `composioConnectedAccounts.${request.toolkitSlug}`;
    const data: z.infer<typeof ComposioConnectedAccount> = {
        id: response.id,
        authConfigId: authConfig.auth_config.id,
        status: 'INITIATED',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    }
    await projectsCollection.updateOne({ _id: projectId }, { $set: { [key]: data } });

    // return the connected account
    return response;
}

export async function syncConnectedAccount(projectId: string, toolkitSlug: string, connectedAccountId: string): Promise<z.infer<typeof ComposioConnectedAccount>> {
    await projectAuthCheck(projectId);

    // ensure that the connected account belongs to this project
    const project = await getProjectConfig(projectId);
    const account = project.composioConnectedAccounts?.[toolkitSlug];
    if (!account || account.id !== connectedAccountId) {
        throw new Error(`Connected account ${connectedAccountId} not found in project ${projectId}`);
    }

    // if account is already active, nothing to sync
    if (account.status === 'ACTIVE') {
        return account;
    }

    // get the connected account
    const response = await libGetConnectedAccount(connectedAccountId);

    // update project with new connected account
    const key = `composioConnectedAccounts.${response.toolkit.slug}`;
    switch (response.status) {
        case 'INITIALIZING':
        case 'INITIATED':
            account.status = 'INITIATED';
            break;
        case 'ACTIVE':
            account.status = 'ACTIVE';
            break;
        default:
            account.status = 'FAILED';
            break;
    }
    account.lastUpdatedAt = new Date().toISOString();
    await projectsCollection.updateOne({ _id: projectId }, { $set: { [key]: account } });

    return account;
}

export async function deleteConnectedAccount(projectId: string, toolkitSlug: string, connectedAccountId: string): Promise<boolean> {
    await projectAuthCheck(projectId);

    // ensure that the connected account belongs to this project
    const project = await getProjectConfig(projectId);
    const account = project.composioConnectedAccounts?.[toolkitSlug];
    if (!account || account.id !== connectedAccountId) {
        throw new Error(`Connected account ${connectedAccountId} not found in project ${projectId} for toolkit ${toolkitSlug}`);
    }

    // delete the connected account
    await libDeleteConnectedAccount(connectedAccountId);

    // get auth config data
    const authConfig = await libGetAuthConfig(account.authConfigId);

    // delete the auth config if it is NOT managed by composio
    if (!authConfig.is_composio_managed) {
        await libDeleteAuthConfig(account.authConfigId);
    }

    // update project with deleted connected account
    const key = `composioConnectedAccounts.${toolkitSlug}`;
    await projectsCollection.updateOne({ _id: projectId }, { $unset: { [key]: "" } });

    return true;
}

export async function updateComposioSelectedTools(projectId: string, tools: z.infer<typeof ZTool>[]): Promise<void> {
    await projectAuthCheck(projectId);

    // update project with new selected tools
    await projectsCollection.updateOne({ _id: projectId }, { $set: { composioSelectedTools: tools } });
}

export async function toggleMockToolkitState(projectId: string, toolkitSlug: string, isMocked: boolean, mockInstructions?: string): Promise<void> {
    await projectAuthCheck(projectId);
    
    const now = new Date().toISOString();
    const key = `composioMockToolkitStates.${toolkitSlug}`;
    
    if (isMocked) {
        // Enable mock mode
        const mockState = {
            toolkitSlug,
            isMocked: true,
            mockInstructions: mockInstructions || 'Mock responses using GPT-4.1 based on tool descriptions.',
            autoSubmitMockedResponse: false,
            createdAt: now,
            lastUpdatedAt: now,
        };
        
        await projectsCollection.updateOne({ _id: projectId }, { $set: { [key]: mockState } });
    } else {
        // Disable mock mode
        await projectsCollection.updateOne({ _id: projectId }, { $unset: { [key]: "" } });
    }
}

export async function updateMockToolkitInstructions(projectId: string, toolkitSlug: string, mockInstructions: string): Promise<void> {
    await projectAuthCheck(projectId);
    
    const now = new Date().toISOString();
    const key = `composioMockToolkitStates.${toolkitSlug}`;
    
    await projectsCollection.updateOne(
        { _id: projectId, [`${key}.toolkitSlug`]: toolkitSlug },
        { 
            $set: { 
                [`${key}.mockInstructions`]: mockInstructions,
                [`${key}.lastUpdatedAt`]: now
            }
        }
    );
}