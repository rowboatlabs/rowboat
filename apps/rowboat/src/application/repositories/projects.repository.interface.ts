import { z } from "zod";
import { ComposioConnectedAccount, CustomMcpServer, Project } from "@/src/entities/models/project";
import { Workflow } from "@/app/lib/types/workflow_types";
import { PaginatedList } from "@/src/entities/common/paginated-list";

/**
 * Schema for creating a new project. Includes name, creator, and optional workflows and secret.
 */
export const CreateSchema = Project
    .pick({
        name: true,
        createdByUserId: true,
        secret: true,
    })
    .extend({
        workflow: Workflow.omit({ lastUpdatedAt: true }),
    });

/**
 * Schema for adding a Composio connected account to a project.
 * Contains the toolkit slug and account data.
 */
export const AddComposioConnectedAccountSchema = z.object({
    toolkitSlug: z.string(),
    data: ComposioConnectedAccount,
});

/**
 * Schema for adding a custom MCP server to a project.
 * Contains the server name and server data.
 */
export const AddCustomMcpServerSchema = z.object({
    name: z.string(),
    data: CustomMcpServer,
});

/**
 * Repository interface for managing projects and their integrations.
 */
export interface IProjectsRepository {
    /**
     * Creates a new project.
     * @param data - The project creation data matching CreateSchema.
     * @returns The created Project object.
     */
    create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof Project>>;

    /**
     * Fetches a project by its ID.
     * @param id - The project ID.
     * @returns The Project object if found, otherwise null.
     */
    fetch(id: string): Promise<z.infer<typeof Project> | null>;

    /**
     * Count projects created by user
     * @param createdByUserId - The creator user ID.
     * @returns The number of projects created by the user.
     */
    countCreatedProjects(createdByUserId: string): Promise<number>;

    /**
     * Lists projects for a user.
     * @param userId - The user ID.
     * @returns The list of projects.
     */
    listProjects(userId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Project>>>>;

    /**
     * Adds a Composio connected account to a project.
     * @param projectId - The project ID.
     * @param data - The connected account data.
     * @returns The updated Project object.
     */
    addComposioConnectedAccount(projectId: string, data: z.infer<typeof AddComposioConnectedAccountSchema>): Promise<z.infer<typeof Project>>;

    /**
     * Deletes a Composio connected account from a project.
     * @param projectId - The project ID.
     * @param toolkitSlug - The toolkit slug to remove.
     * @returns True if the account was deleted, false otherwise.
     */
    deleteComposioConnectedAccount(projectId: string, toolkitSlug: string): Promise<boolean>;

    /**
     * Adds a custom MCP server to a project.
     * @param projectId - The project ID.
     * @param data - The custom MCP server data.
     * @returns The updated Project object.
     */
    addCustomMcpServer(projectId: string, data: z.infer<typeof AddCustomMcpServerSchema>): Promise<z.infer<typeof Project>>;

    /**
     * Deletes a custom MCP server from a project.
     * @param projectId - The project ID.
     * @param name - The name of the custom MCP server to remove.
     * @returns True if the server was deleted, false otherwise.
     */
    deleteCustomMcpServer(projectId: string, name: string): Promise<boolean>;

    /**
     * Updates the secret for a project.
     * @param projectId - The project ID.
     * @param secret - The new secret value.
     * @returns The updated Project object.
     */
    updateSecret(projectId: string, secret: string): Promise<z.infer<typeof Project>>;

    /**
     * Updates the webhook URL for a project.
     * @param projectId - The project ID.
     * @param url - The new webhook URL.
     * @returns The updated Project object.
     */
    updateWebhookUrl(projectId: string, url: string): Promise<z.infer<typeof Project>>;

    /**
     * Updates the name of a project.
     * @param projectId - The project ID.
     * @param name - The new project name.
     * @returns The updated Project object.
     */
    updateName(projectId: string, name: string): Promise<z.infer<typeof Project>>;

    /**
     * Updates the draft workflow for a project.
     * @param projectId - The project ID.
     * @param workflow - The new draft workflow.
     * @returns The updated Project object.
     */
    updateDraftWorkflow(projectId: string, workflow: z.infer<typeof Workflow>): Promise<z.infer<typeof Project>>;

    /**
     * Updates the live workflow for a project.
     * @param projectId - The project ID.
     * @param workflow - The new live workflow.
     * @returns The updated Project object.
     */
    updateLiveWorkflow(projectId: string, workflow: z.infer<typeof Workflow>): Promise<z.infer<typeof Project>>;

    /**
     * Deletes a project by its ID.
     * @param projectId - The project ID.
     * @returns True if the project was deleted, false otherwise.
     */
    delete(projectId: string): Promise<boolean>;
}