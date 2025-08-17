"use server";
import { z } from "zod";
import { ZToolkit, ZGetToolkitResponse, ZTool, ZListResponse, ZCreateConnectedAccountResponse, ZAuthScheme, ZCredentials } from "@/app/lib/composio/composio";
import { ComposioConnectedAccount } from "@/src/entities/models/project";
import { container } from "@/di/container";
import { ICreateComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/create-composio-trigger-deployment.controller";
import { IListComposioTriggerDeploymentsController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-deployments.controller";
import { IDeleteComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/delete-composio-trigger-deployment.controller";
import { IListComposioTriggerTypesController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-types.controller";
import { IDeleteComposioConnectedAccountController } from "@/src/interface-adapters/controllers/projects/delete-composio-connected-account.controller";
import { authCheck } from "./auth.actions";
import { ICreateComposioManagedConnectedAccountController } from "@/src/interface-adapters/controllers/projects/create-composio-managed-connected-account.controller";
import { ICreateCustomConnectedAccountController } from "@/src/interface-adapters/controllers/projects/create-custom-connected-account.controller";
import { ISyncConnectedAccountController } from "@/src/interface-adapters/controllers/projects/sync-connected-account.controller";
import { IListComposioToolkitsController } from "@/src/interface-adapters/controllers/projects/list-composio-toolkits.controller";
import { IGetComposioToolkitController } from "@/src/interface-adapters/controllers/projects/get-composio-toolkit.controller";
import { IListComposioToolsController } from "@/src/interface-adapters/controllers/projects/list-composio-tools.controller";

const createComposioTriggerDeploymentController = container.resolve<ICreateComposioTriggerDeploymentController>("createComposioTriggerDeploymentController");
const listComposioTriggerDeploymentsController = container.resolve<IListComposioTriggerDeploymentsController>("listComposioTriggerDeploymentsController");
const deleteComposioTriggerDeploymentController = container.resolve<IDeleteComposioTriggerDeploymentController>("deleteComposioTriggerDeploymentController");
const listComposioTriggerTypesController = container.resolve<IListComposioTriggerTypesController>("listComposioTriggerTypesController");
const deleteComposioConnectedAccountController = container.resolve<IDeleteComposioConnectedAccountController>("deleteComposioConnectedAccountController");
const createComposioManagedConnectedAccountController = container.resolve<ICreateComposioManagedConnectedAccountController>("createComposioManagedConnectedAccountController");
const createCustomConnectedAccountController = container.resolve<ICreateCustomConnectedAccountController>("createCustomConnectedAccountController");
const syncConnectedAccountController = container.resolve<ISyncConnectedAccountController>("syncConnectedAccountController");
const listComposioToolkitsController = container.resolve<IListComposioToolkitsController>("listComposioToolkitsController");
const getComposioToolkitController = container.resolve<IGetComposioToolkitController>("getComposioToolkitController");
const listComposioToolsController = container.resolve<IListComposioToolsController>("listComposioToolsController");

const ZCreateCustomConnectedAccountRequest = z.object({
    toolkitSlug: z.string(),
    authConfig: z.object({
        authScheme: ZAuthScheme,
        credentials: ZCredentials,
    }),
    callbackUrl: z.string(),
});

export async function listToolkits(projectId: string, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
    const user = await authCheck();
    return await listComposioToolkitsController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        cursor,
    });
}

export async function getToolkit(projectId: string, toolkitSlug: string): Promise<z.infer<typeof ZGetToolkitResponse>> {
    const user = await authCheck();
    return await getComposioToolkitController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug,
    });
}

export async function listTools(projectId: string, toolkitSlug: string, searchQuery: string | null, cursor: string | null = null): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZTool>>>> {
    const user = await authCheck();
    return await listComposioToolsController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug,
        searchQuery,
        cursor,
    });
}

export async function createComposioManagedOauth2ConnectedAccount(projectId: string, toolkitSlug: string, callbackUrl: string): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    const user = await authCheck();
    return await createComposioManagedConnectedAccountController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug,
        callbackUrl,
    });
}

export async function createCustomConnectedAccount(projectId: string, request: z.infer<typeof ZCreateCustomConnectedAccountRequest>): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
    const user = await authCheck();
    return await createCustomConnectedAccountController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug: request.toolkitSlug,
        authConfig: request.authConfig,
        callbackUrl: request.callbackUrl,
    });
}

export async function syncConnectedAccount(projectId: string, toolkitSlug: string, connectedAccountId: string): Promise<z.infer<typeof ComposioConnectedAccount>> {
    const user = await authCheck();
    return await syncConnectedAccountController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug,
        connectedAccountId,
    });
}

export async function deleteConnectedAccount(projectId: string, toolkitSlug: string): Promise<boolean> {
    const user = await authCheck();

    await deleteComposioConnectedAccountController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        toolkitSlug,
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