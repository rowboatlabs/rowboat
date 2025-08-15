import { PaginatedList } from "@/src/entities/common/paginated-list";
import { DataSource } from "@/src/entities/models/data-source";
import { z } from "zod";

/**
 * Schema for creating a new DataSource. Requires projectId, name, description, and data fields.
 */
export const CreateSchema = DataSource.pick({
    projectId: true,
    name: true,
    description: true,
    data: true,
    status: true,
});

/**
 * Schema for updating an existing DataSource. Allows updating status, billingError, error, attempts, active, and description fields.
 */
export const UpdateSchema = DataSource
    .pick({
        billingError: true,
        error: true,
        description: true,
    })
    .extend({
        status: DataSource.shape.status.optional(),
        active: DataSource.shape.active.optional(),
        attempts: DataSource.shape.attempts.optional(),
    });

/**
 * Filters schema for listing DataSources. Supports optional filtering by active and deleted status.
 */
export const ListFiltersSchema = z.object({
    active: z.boolean().optional(),
    deleted: z.boolean().optional(),
}).strict();

/**
 * Schema for the payload of a release operation.
 */
export const ReleasePayloadSchema = DataSource.pick({
    status: true,
    error: true,
    billingError: true,
});

/**
 * Repository interface for managing DataSource entities in the persistence layer.
 */
export interface IDataSourcesRepository {
    /**
     * Creates a new DataSource with the provided data.
     * @param data - The data required to create a DataSource (see CreateSchema).
     * @returns The created DataSource object.
     */
    create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof DataSource>>;

    /**
     * Fetches a DataSource by its unique identifier.
     * @param id - The unique ID of the DataSource.
     * @returns The DataSource object if found, otherwise null.
     */
    fetch(id: string): Promise<z.infer<typeof DataSource> | null>;

    /**
     * Lists DataSources for a given project, with optional filters, cursor, and limit for pagination.
     * @param projectId - The project ID to list DataSources for.
     * @param filters - Optional filters (see ListFiltersSchema).
     * @param cursor - Optional pagination cursor.
     * @param limit - Optional maximum number of results to return.
     * @returns A paginated list of DataSources.
     */
    list(
        projectId: string,
        filters?: z.infer<typeof ListFiltersSchema>,
        cursor?: string,
        limit?: number
    ): Promise<z.infer<ReturnType<typeof PaginatedList<typeof DataSource>>>>;

    /**
     * Updates an existing DataSource by its ID with the provided data.
     * @param id - The unique ID of the DataSource to update.
     * @param data - The fields to update (see UpdateSchema).
     * @param bumpVersion - Optional flag to increment the version.
     * @returns The updated DataSource object.
     */
    update(id: string, data: z.infer<typeof UpdateSchema>, bumpVersion?: boolean): Promise<z.infer<typeof DataSource>>;

    /**
     * Deletes a DataSource by its unique identifier.
     * @param id - The unique ID of the DataSource to delete.
     * @returns True if the DataSource was deleted, false otherwise.
     */
    delete(id: string): Promise<boolean>;

    /**
     * Deletes all DataSources associated with a given project ID.
     * @param projectId - The project ID whose DataSources should be deleted.
     * @returns A promise that resolves when the operation is complete.
     */
    deleteByProjectId(projectId: string): Promise<void>;

    /**
     * Polls for a datasource that is pending delete and returns it
     * @returns The datasource if found, otherwise null.
     */
    pollDeleteJob(): Promise<z.infer<typeof DataSource> | null>;

    /**
     * Polls for a datasource that is pending processing and returns it
     * @returns The datasource if found, otherwise null.
     */
    pollPendingJob(): Promise<z.infer<typeof DataSource> | null>;

    /**
     * Releases a datasource by its ID and version.
     * @param id - The unique ID of the datasource to release.
     * @param version - The version of the datasource to release.
     * @param updates - The updates to apply to the datasource (see ReleasePayloadSchema).
     */
    release(id: string, version: number, updates: z.infer<typeof ReleasePayloadSchema>): Promise<void>;
}