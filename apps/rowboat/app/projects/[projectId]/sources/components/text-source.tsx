"use client";
import { WithStringId } from "../../../../lib/types/types";
import { DataSource } from "../../../../lib/types/datasource_types";
import { z } from "zod";
import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { FormStatusButton } from "../../../../lib/components/form-status-button";
import { Spinner } from "@heroui/react";
import { addDocsToDataSource, deleteDocsFromDataSource, listDocsInDataSource } from "../../../../actions/datasource_actions";
import { Section } from "./section";
import { toast } from "sonner";

export function TextSource({
    projectId,
    dataSource,
    handleReload,
}: {
    projectId: string,
    dataSource: WithStringId<z.infer<typeof DataSource>>,
    handleReload: () => void;
}) {
    const [content, setContent] = useState("");
    const [docId, setDocId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        let ignore = false;

        async function fetchContent() {
            setIsLoading(true);
            try {
                const { files } = await listDocsInDataSource({
                    projectId,
                    sourceId: dataSource._id,
                    limit: 1,
                });

                console.log('got data', files);

                if (!ignore && files.length > 0) {
                    const doc = files[0];
                    if (doc.data.type === 'text') {
                        setContent(doc.data.content);
                        setDocId(doc._id);
                    }
                }
            } catch (error) {
                console.error('Error fetching content:', error);
                toast.error('Error fetching content:', {
                    description: 'Unable to fetch content. Please try again.'
                });
            } finally {
                setIsLoading(false);
            }
        }

        fetchContent();
        return () => {
            ignore = true;
        };
    }, [projectId, dataSource._id]);

    async function handleSubmit(formData: FormData) {
        setIsSaving(true);
        try {
            const newContent = formData.get('content') as string;

            // Delete existing doc if it exists
            if (docId) {
                await deleteDocsFromDataSource({
                    projectId,
                    sourceId: dataSource._id,
                    docIds: [docId],
                });
            }

            // Add new doc
            await addDocsToDataSource({
                projectId,
                sourceId: dataSource._id,
                docData: [{
                    name: 'text',
                    data: {
                        type: 'text',
                        content: newContent,
                    },
                }],
            });

            handleReload();
        } finally {
            setIsSaving(false);
        }
    }

    if (isLoading) {
        return (
            <Section title="Content" description="Manage the text content for this data source.">
                <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <Spinner size="sm" />
                    <p>Loading content...</p>
                </div>
            </Section>
        );
    }

    return (
        <Section title="Content" description="Manage the text content for this data source.">
            <form action={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Text content
                    </label>
                    <Textarea
                        name="content"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={10}
                        className="rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                    />
                </div>
                <FormStatusButton
                    props={{
                        type: "submit",
                        children: "Update content",
                        className: "self-start",
                        isLoading: isSaving,
                    }}
                />
            </form>
        </Section>
    );
}
