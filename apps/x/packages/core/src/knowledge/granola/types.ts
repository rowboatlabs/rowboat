import z from "zod";

// --- Config Schema ---

export const GranolaConfig = z.object({
    enabled: z.boolean(),
});
export type GranolaConfig = z.infer<typeof GranolaConfig>;

// --- API Schemas ---

// ProseMirror node (recursive structure)
export const ProseMirrorNode: z.ZodType<{
    type: string;
    attrs?: Record<string, unknown>;
    content?: unknown[];
    text?: string;
}> = z.object({
    type: z.string(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(z.lazy(() => ProseMirrorNode)).optional(),
    text: z.string().optional(),
}).passthrough();

export const Document = z.object({
    id: z.string(),
    created_at: z.string(),
    updated_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    user_id: z.string().optional(),
    workspace_id: z.string().nullable().optional(),
    public: z.boolean().optional(),
    notes: ProseMirrorNode.optional().nullable(),
    notes_plain: z.string().nullable().optional(),
    notes_markdown: z.string().nullable().optional(),
    last_viewed_panel: z.object({
        content: z.union([ProseMirrorNode, z.string()]).optional().nullable(),
    }).passthrough().optional().nullable(),
}).passthrough(); // Allow additional fields
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

// Document reference in a list (may be partial, we only need id)
export const DocumentRef = z.object({
    id: z.string(),
}).passthrough(); // Allow additional fields

export const DocumentListItem = z.object({
    id: z.string(),
    title: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    documents: z.array(DocumentRef),
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

