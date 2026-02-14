import { z } from "zod";
import { IComposioService } from "../composio-service.js";
import * as composioClient from "../../composio/client.js";
import {
    ZCreateAuthConfigRequest,
    ZCreateAuthConfigResponse,
    ZAuthConfig,
    ZConnectedAccount,
    ZCreateConnectedAccountRequest,
    ZCreateConnectedAccountResponse,
    ZDeleteOperationResponse,
    ZExecuteActionResponse,
    ZListResponse,
    ZToolkit,
} from "../../composio/types.js";

export class LocalComposioService implements IComposioService {
    isConfigured(): boolean {
        return composioClient.isConfigured();
    }

    setApiKey(apiKey: string): void {
        composioClient.setApiKey(apiKey);
    }

    async executeAction(
        actionSlug: string,
        connectedAccountId: string,
        input: Record<string, unknown>,
    ): Promise<z.infer<typeof ZExecuteActionResponse>> {
        return composioClient.executeAction(actionSlug, connectedAccountId, input);
    }

    async listToolkits(
        cursor: string | null = null,
    ): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>> {
        return composioClient.listToolkits(cursor);
    }

    async getToolkit(toolkitSlug: string): Promise<z.infer<typeof ZToolkit>> {
        return composioClient.getToolkit(toolkitSlug);
    }

    async listToolkitTools(
        toolkitSlug: string,
        searchQuery: string | null = null,
    ): Promise<{ items: Array<{ slug: string; name: string; description: string }> }> {
        return composioClient.listToolkitTools(toolkitSlug, searchQuery);
    }

    async listAuthConfigs(
        toolkitSlug: string,
        cursor: string | null = null,
        managedOnly: boolean = false,
    ): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZAuthConfig>>>> {
        return composioClient.listAuthConfigs(toolkitSlug, cursor, managedOnly);
    }

    async createAuthConfig(
        request: z.infer<typeof ZCreateAuthConfigRequest>,
    ): Promise<z.infer<typeof ZCreateAuthConfigResponse>> {
        return composioClient.createAuthConfig(request);
    }

    async deleteAuthConfig(
        authConfigId: string,
    ): Promise<z.infer<typeof ZDeleteOperationResponse>> {
        return composioClient.deleteAuthConfig(authConfigId);
    }

    async createConnectedAccount(
        request: z.infer<typeof ZCreateConnectedAccountRequest>,
    ): Promise<z.infer<typeof ZCreateConnectedAccountResponse>> {
        return composioClient.createConnectedAccount(request);
    }

    async getConnectedAccount(
        connectedAccountId: string,
    ): Promise<z.infer<typeof ZConnectedAccount>> {
        return composioClient.getConnectedAccount(connectedAccountId);
    }

    async deleteConnectedAccount(
        connectedAccountId: string,
    ): Promise<z.infer<typeof ZDeleteOperationResponse>> {
        return composioClient.deleteConnectedAccount(connectedAccountId);
    }
}
