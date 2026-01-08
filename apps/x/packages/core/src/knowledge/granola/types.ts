import z from "zod";

// --- Config Schema ---

export const GranolaConfig = z.object({
    enabled: z.boolean(),
});
export type GranolaConfig = z.infer<typeof GranolaConfig>;

// --- API Schemas ---

export const Document = z.object({
    id: z.string(),
    created_at: z.string(),
    updated_at: z.string().nullable(),
    deleted_at: z.string().nullable(),
    notes: z.object({
        type: z.string(),
        content: z.array(z.object({
            type: z.string(),
            attrs: z.object({
                id: z.string(),
            }).optional(),
            content: z.array(z.object({
                type: z.string(),
                text: z.string().optional(),
            })).optional(),
        })),
    }).optional(),
    title: z.string().nullable(),
    type: z.string(),
    user_id: z.string(),
    notes_plain: z.string().optional(),
    notes_markdown: z.string().optional(),
    workspace_id: z.string().nullable(),
    public: z.boolean(),
});
export type Document = z.infer<typeof Document>;

export const GetWorkspacesResponse = z.object({
    workspaces: z.array(z.object({
        workspace: z.object({
            workspace_id: z.string(),
            slug: z.string(),
            display_name: z.string(),
        }),
        role: z.string(),
        plan_type: z.string(),
    })),
});
export type GetWorkspacesResponse = z.infer<typeof GetWorkspacesResponse>;

export const GetDocumentsRequest = z.object({
    limit: z.number(),
    offset: z.number(),
});
export type GetDocumentsRequest = z.infer<typeof GetDocumentsRequest>;

export const GetDocumentsResponse = z.object({
    docs: z.array(Document),
    deleted: z.array(z.string()),
});
export type GetDocumentsResponse = z.infer<typeof GetDocumentsResponse>;

export const GetDocumentTranscriptRequest = z.object({
    document_id: z.string(),
});
export type GetDocumentTranscriptRequest = z.infer<typeof GetDocumentTranscriptRequest>;

export const GetDocumentTranscriptResponse = z.array(z.object({
    source: z.enum(['microphone', 'system']),
    text: z.string(),
    start_timestamp: z.string(),
    end_timestamp: z.string(),
    confidence: z.number(),
}));
export type GetDocumentTranscriptResponse = z.infer<typeof GetDocumentTranscriptResponse>;

export const DocumentListItem = z.object({
    id: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    documents: z.array(Document),
});
export type DocumentListItem = z.infer<typeof DocumentListItem>;

export const GetDocumentListsResponse = z.object({
    lists: z.array(DocumentListItem),
});
export type GetDocumentListsResponse = z.infer<typeof GetDocumentListsResponse>;

export const GetDocumentsBatchRequest = z.object({
    document_ids: z.array(z.string()),
});
export type GetDocumentsBatchRequest = z.infer<typeof GetDocumentsBatchRequest>;

export const GetDocumentsBatchResponse = z.object({
    docs: z.array(Document),
});
export type GetDocumentsBatchResponse = z.infer<typeof GetDocumentsBatchResponse>;

// --- Sync State Schema ---

export const SyncState = z.object({
    lastSyncDate: z.string(),
    syncedDocs: z.record(z.string(), z.string()), // { documentId: updated_at }
});
export type SyncState = z.infer<typeof SyncState>;

