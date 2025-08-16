import { PaginatedList } from "@/src/entities/common/paginated-list";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { z } from "zod";

/**
 * Schema for creating a new DataSourceDoc. Requires projectId, sourceId, name, status, and data fields.
 */
export const CreateSchema = DataSourceDoc.pick({
    name: true,
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
     * Creates multiple DataSourceDocs with the provided data.
     * @param projectId - The project ID to create the DataSourceDocs for.
     * @param sourceId - The source ID to create the DataSourceDocs for.
     * @param data - The data required to create a DataSourceDoc (see CreateSchema).
     * @returns The IDs of the created DataSourceDocs.
     */
    bulkCreate(
        projectId: string,
        sourceId: string,
        data: z.infer<typeof CreateSchema>[]
    ): Promise<string[]>;

    /**
     * Fetches a DataSourceDoc by its unique identifier.
     * @param id - The unique ID of the DataSourceDoc.
     * @returns The DataSourceDoc object if found, otherwise null.
     */
    fetch(id: string): Promise<z.infer<typeof DataSourceDoc> | null>;

    /**
     * Fetches multiple DataSourceDocs by their unique identifiers.
     * @param ids - The unique IDs of the DataSourceDocs.
     * @returns The DataSourceDocs objects that were found
     */
    bulkFetch(ids: string[]): Promise<z.infer<typeof DataSourceDoc>[]>;

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
     * Marks all docs for a given source as pending.
     * @param sourceId - The source ID to mark docs for.
     */
    markSourceDocsPending(sourceId: string): Promise<void>;

    /**
     * Marks a DataSourceDoc as deleted.
     * @param id - The unique ID of the DataSourceDoc to mark as deleted.
     */
    markAsDeleted(id: string): Promise<void>;

    /**
     * Updates an existing DataSourceDoc by its ID and version with the provided data.
     * @param id - The unique ID of the DataSourceDoc to update.
     * @param version - Version of the DataSourceDoc for optimistic concurrency control.
     * @param data - Fields to update (see UpdateSchema).
     * @returns The updated DataSourceDoc object.
     */
    updateByVersion(
        id: string,
        version: number,
        data: z.infer<typeof UpdateSchema>
    ): Promise<z.infer<typeof DataSourceDoc>>;

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
    deleteBySourceId(sourceId: string): Promise<void>;
}