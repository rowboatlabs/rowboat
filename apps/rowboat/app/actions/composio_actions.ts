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
import { ComposioConnectedAccount } from "@/app/lib/types/project_types";
import { getProjectConfig, projectAuthCheck } from "./project_actions";
import { projectsCollection } from "../lib/mongodb";
import { container } from "@/di/container";
import { ICreateComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/create-composio-trigger-deployment.controller";
import { IListComposioTriggerDeploymentsController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-deployments.controller";
import { IDeleteComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/delete-composio-trigger-deployment.controller";
import { IListComposioTriggerTypesController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-types.controller";
import { IDeleteComposioConnectedAccountController } from "@/src/interface-adapters/controllers/composio/delete-composio-connected-account.controller";
import { authCheck } from "./auth_actions";

const createComposioTriggerDeploymentController = container.resolve<ICreateComposioTriggerDeploymentController>("createComposioTriggerDeploymentController");
const listComposioTriggerDeploymentsController = container.resolve<IListComposioTriggerDeploymentsController>("listComposioTriggerDeploymentsController");
const deleteComposioTriggerDeploymentController = container.resolve<IDeleteComposioTriggerDeploymentController>("deleteComposioTriggerDeploymentController");
const listComposioTriggerTypesController = container.resolve<IListComposioTriggerTypesController>("listComposioTriggerTypesController");
const deleteComposioConnectedAccountController = container.resolve<IDeleteComposioConnectedAccountController>("deleteComposioConnectedAccountController");

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

export async function listTools(projectId: string, toolkitSlug: string, searchQuery: string | null, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    await projectAuthCheck(projectId);
    return await libListTools(toolkitSlug, searchQuery, cursor);
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
    const user = await authCheck();

    await deleteComposioConnectedAccountController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug,
        connectedAccountId,
    });

    return true;
}

export async function listComposioTriggerTypes(toolkitSlug: string, cursor?: string) {
    await authCheck();

    return await listComposioTriggerTypesController.execute({
        toolkitSlug,
        cursor,
    });
}

export async function createComposioTriggerDeployment(request: {
    projectId: string,
    toolkitSlug: string,
    triggerTypeSlug: string,
    connectedAccountId: string,
    triggerConfig?: Record<string, unknown>,
}) {
    const user = await authCheck();

    // create trigger deployment
    return await createComposioTriggerDeploymentController.execute({
        caller: 'user',
        userId: user._id,
        data: {
            projectId: request.projectId,
            toolkitSlug: request.toolkitSlug,
            triggerTypeSlug: request.triggerTypeSlug,
            connectedAccountId: request.connectedAccountId,
            triggerConfig: request.triggerConfig ?? {},
        },
    });
}

export async function listComposioTriggerDeployments(request: {
    projectId: string,
    cursor?: string,
}) {
    const user = await authCheck();

    // list trigger deployments
    return await listComposioTriggerDeploymentsController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        cursor: request.cursor,
    });
}

export async function deleteComposioTriggerDeployment(request: {
    projectId: string,
    deploymentId: string,
}) {
    const user = await authCheck();

    // delete trigger deployment
    return await deleteComposioTriggerDeploymentController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        deploymentId: request.deploymentId,
    });
}