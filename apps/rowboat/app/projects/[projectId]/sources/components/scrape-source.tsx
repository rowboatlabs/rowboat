"use client";
import { WithStringId } from "../../../../lib/types/types";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { DataSource } from "@/src/entities/models/data-source";
import { z } from "zod";
import { Recrawl } from "./web-recrawl";
import { deleteDocsFromDataSource, listDocsInDataSource, recrawlWebDataSource, addDocsToDataSource } from "../../../../actions/data-source.actions";
import { useState, useEffect } from "react";
import { Spinner, Pagination } from "@heroui/react";
import { ExternalLinkIcon, PlusIcon } from "lucide-react";
import { FormStatusButton } from "../../../../lib/components/form-status-button";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "./section";

function UrlListItem({ file, onDelete }: {
    file: WithStringId<z.infer<typeof DataSourceDoc>>,
    onDelete: (fileId: string) => Promise<void>;
}) {
    const [isDeleting, setIsDeleting] = useState(false);

    if (file.data.type !== 'url') return null;

    return (
        <div className="flex items-center justify-between py-3 px-1 border-b border-gray-100 dark:border-gray-800 group hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
            <div className="flex items-center gap-2">
                <p className="text-sm text-gray-900 dark:text-gray-100">{file.name}</p>
                <a 
                    href={file.data.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                >
                    <ExternalLinkIcon className="w-3.5 h-3.5" />
                </a>
            </div>
            <button
                onClick={async () => {
                    setIsDeleting(true);
                    try {
                        await onDelete(file._id);
                    } finally {
                        setIsDeleting(false);
                    }
                }}
                disabled={isDeleting}
                className="text-sm text-gray-400 hover:text-red-600 dark:text-gray-500 dark:hover:text-red-400 transition-colors disabled:opacity-50"
            >
                {isDeleting ? <Spinner size="sm" /> : 'Delete'}
            </button>
        </div>
    );
}

function UrlList({ projectId, sourceId, onDelete }: {
    projectId: string,
    sourceId: string,
    onDelete: (fileId: string) => Promise<void>,
}) {
    const [files, setFiles] = useState<WithStringId<z.infer<typeof DataSourceDoc>>[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    const totalPages = Math.ceil(total / 10);

    useEffect(() => {
        let ignore = false;

        async function fetchFiles() {
            setLoading(true);
            try {
                const { files, total } = await listDocsInDataSource({ projectId, sourceId, page, limit: 10 });
                if (!ignore) {
                    setFiles(files);
                    setTotal(total);
                }
            } catch (error) {
                console.error('Error fetching files:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchFiles();

        return () => {
            ignore = true;
        };
    }, [projectId, sourceId, page]);

    return (
        <div className="mt-6 space-y-4">
            {loading ? (
                <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                    <Spinner size="sm" />
                    <p>Loading URLs...</p>
                </div>
            ) : files.length === 0 ? (
                <div className="text-center text-sm text-gray-600 dark:text-gray-300">
                    No URLs added yet
                </div>
            ) : (
                <div className="space-y-2">
                    {files.map(file => (
                        <UrlListItem key={file._id} file={file} onDelete={onDelete} />
                    ))}
                    {Math.ceil(total / 10) > 1 && (
                        <div className="mt-4">
                            <Pagination
                                total={Math.ceil(total / 10)}
                                page={page}
                                onChange={setPage}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export function ScrapeSource({
    projectId,
    dataSource,
    handleReload,
}: {
    projectId: string,
    dataSource: z.infer<typeof DataSource>,
    handleReload: () => void;
}) {
    const [fileListKey, setFileListKey] = useState(0);
    const [showAddForm, setShowAddForm] = useState(false);

    return (
        <div className="space-y-6">
            <Section
                title="URLs"
                description="Manage the URLs that will be scraped for this data source."
            >
                <div className="space-y-6">
                    {!showAddForm && (
                        <Button
                            onClick={() => setShowAddForm(true)}
                            variant="primary"
                            size="sm"
                        >
                            <div className="flex items-center gap-1.5">
                                <PlusIcon className="w-3.5 h-3.5" />
                                Add URLs
                            </div>
                        </Button>
                    )}

                    {showAddForm && (
                        <form 
                            action={async (formData) => {
                                const urls = formData.get('urls') as string;
                                const urlsArray = urls.split('\n')
                                    .map(url => url.trim())
                                    .filter(url => url.length > 0);
                                const first100Urls = urlsArray.slice(0, 100);
                                
                                await addDocsToDataSource({
                                    projectId,
                                    sourceId: dataSource.id,
                                    docData: first100Urls.map(url => ({
                                        name: url,
                                        data: {
                                            type: 'url',
                                            url,
                                        },
                                    })),
                                });
                                handleReload();
                                setShowAddForm(false);
                            }} 
                            className="space-y-4"
                        >
                            <div className="space-y-2">
                                <label className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                    Add URLs (one per line)
                                </label>
                                <Textarea
                                    required
                                    name="urls"
                                    rows={5}
                                    placeholder="https://example.com"
                                    className="rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750"
                                />
                            </div>
                            <div className="flex gap-2">
                                <FormStatusButton
                                    props={{
                                        type: "submit",
                                        children: "Add URLs",
                                        startContent: <PlusIcon className="w-4 h-4" />,
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowAddForm(false)}
                                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    )}

                    <UrlList
                        key={fileListKey}
                        projectId={projectId}
                        sourceId={dataSource.id}
                        onDelete={async (docId) => {
                            await deleteDocsFromDataSource({
                                projectId,
                                sourceId: dataSource.id,
                                docIds: [docId],
                            });
                            handleReload();
                            setFileListKey(prev => prev + 1);
                        }}
                    />
                </div>
            </Section>

            {(dataSource.status === 'ready' || dataSource.status === 'error') && (
                <Section
                    title="Refresh Content"
                    description="Update the content by scraping the URLs again."
                >
                    <Recrawl 
                        projectId={projectId} 
                        sourceId={dataSource.id} 
                        handleRefresh={async () => {
                            await recrawlWebDataSource(projectId, dataSource.id);
                            handleReload();
                            setFileListKey(prev => prev + 1);
                        }} 
                    />
                </Section>
            )}
        </div>
    );
}