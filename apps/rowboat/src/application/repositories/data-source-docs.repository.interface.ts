import { PaginatedList } from "@/src/entities/common/paginated-list";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { z } from "zod";

/**
 * Schema for creating a new DataSourceDoc. Requires projectId, sourceId, name, status, and data fields.
 */
export const CreateSchema = DataSourceDoc.pick({
    projectId: true,
    sourceId: true,
    name: true,
    status: true,
    data: true,
});

/**
 * Schema for updating an existing DataSourceDoc. Allows updating status, content, and error fields.
 */
export const UpdateSchema = DataSourceDoc
    .pick({
        status: true,
        content: true,
        error: true,
    })
    .partial();

/**
 * Schema used to perform bulk updates across multiple DataSourceDocs. Allows updating status and attempts fields.
 */
export const BulkUpdateSchema = DataSourceDoc
    .pick({
        status: true,
        attempts: true,
    })
    .partial();

/**
 * Filters schema for listing DataSourceDocs. Supports optional filtering by one or more statuses.
 */
export const ListFiltersSchema = z.object({
    status: z.array(DataSourceDoc.shape.status).optional(),
}).strict();

/**
 * Repository interface for managing DataSourceDoc entities in the persistence layer.
 */
export interface IDataSourceDocsRepository {
    /**
     * Creates a new DataSourceDoc with the provided data.
     * @param data - The data required to create a DataSourceDoc (see CreateSchema).
     * @returns The created DataSourceDoc object.
     */
    create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof DataSourceDoc>>;

    /**
     * Fetches a DataSourceDoc by its unique identifier.
     * @param id - The unique ID of the DataSourceDoc.
     * @returns The DataSourceDoc object if found, otherwise null.
     */
    fetch(id: string): Promise<z.infer<typeof DataSourceDoc> | null>;

    /**
     * Lists DataSourceDocs for a given source, with optional filters, cursor, and limit for pagination.
     * @param sourceId - The source ID to list DataSourceDocs for.
     * @param filters - Optional filters (see ListFiltersSchema).
     * @param cursor - Optional pagination cursor.
     * @param limit - Optional maximum number of results to return.
     * @returns A paginated list of DataSourceDocs.
     */
    list(
        sourceId: string,
        filters?: z.infer<typeof ListFiltersSchema>,
        cursor?: string,
        limit?: number
    ): Promise<z.infer<ReturnType<typeof PaginatedList<typeof DataSourceDoc>>>>;

    /**
     * Updates an existing DataSourceDoc by its ID and version with the provided data.
     * @param id - The unique ID of the DataSourceDoc to update.
     * @param version - The current version of the DataSourceDoc for optimistic concurrency control.
     * @param data - The fields to update (see UpdateSchema).
     * @returns The updated DataSourceDoc object.
     */
    update(id: string, version: number, data: z.infer<typeof UpdateSchema>): Promise<z.infer<typeof DataSourceDoc>>;

    /**
     * Applies updates to multiple DataSourceDocs belonging to the provided source.
     * @param sourceId - The source ID whose documents should be updated.
     * @param data - An array of updates to apply (see BulkUpdateSchema).
     * @param bumpVersion - Optional flag to increment the version for updated documents.
     */
    bulkUpdate(sourceId: string, data: z.infer<typeof BulkUpdateSchema>[], bumpVersion?: boolean): Promise<void>;

    /**
     * Deletes a DataSourceDoc by its unique identifier.
     * @param id - The unique ID of the DataSourceDoc to delete.
     * @returns True if the DataSourceDoc was deleted, false otherwise.
     */
    delete(id: string): Promise<boolean>;

    /**
     * Deletes all DataSourceDocs associated with a given source ID.
     * @param sourceId - The source ID whose documents should be deleted.
     */
    bulkDelete(sourceId: string): Promise<void>;
}