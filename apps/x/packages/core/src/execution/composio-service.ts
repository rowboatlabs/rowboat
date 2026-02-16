import { z } from "zod";
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
} from "../composio/types.js";

export interface IComposioService {
    isConfigured(): boolean;
    setApiKey(apiKey: string): void;
    executeAction(
        actionSlug: string,
        connectedAccountId: string,
        input: Record<string, unknown>,
    ): Promise<z.infer<typeof ZExecuteActionResponse>>;
    listToolkits(
        cursor?: string | null,
    ): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZToolkit>>>>;
    getToolkit(toolkitSlug: string): Promise<z.infer<typeof ZToolkit>>;
    listToolkitTools(
        toolkitSlug: string,
        searchQuery?: string | null,
    ): Promise<{ items: Array<{ slug: string; name: string; description: string }> }>;
    listAuthConfigs(
        toolkitSlug: string,
        cursor?: string | null,
        managedOnly?: boolean,
    ): Promise<z.infer<ReturnType<typeof ZListResponse<typeof ZAuthConfig>>>>;
    createAuthConfig(
        request: z.infer<typeof ZCreateAuthConfigRequest>,
    ): Promise<z.infer<typeof ZCreateAuthConfigResponse>>;
    deleteAuthConfig(
        authConfigId: string,
    ): Promise<z.infer<typeof ZDeleteOperationResponse>>;
    createConnectedAccount(
        request: z.infer<typeof ZCreateConnectedAccountRequest>,
    ): Promise<z.infer<typeof ZCreateConnectedAccountResponse>>;
    getConnectedAccount(
        connectedAccountId: string,
    ): Promise<z.infer<typeof ZConnectedAccount>>;
    deleteConnectedAccount(
        connectedAccountId: string,
    ): Promise<z.infer<typeof ZDeleteOperationResponse>>;
}
