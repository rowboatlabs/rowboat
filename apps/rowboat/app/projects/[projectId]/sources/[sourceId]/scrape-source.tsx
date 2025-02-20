"use client";
import { PageSection } from "../../../../lib/components/page-section";
import { WithStringId } from "../../../../lib/types/types";
import { DataSourceDoc } from "../../../../lib/types/datasource_types";
import { DataSource } from "../../../../lib/types/datasource_types";
import { z } from "zod";
import { Recrawl } from "./web-recrawl";
import { deleteDocsFromDataSource, listDocsInDataSource, recrawlWebDataSource, addDocsToDataSource } from "../../../../actions/datasource_actions";
import { useState, useEffect } from "react";
import { Spinner } from "@nextui-org/react";
import { Pagination } from "@nextui-org/react";
import { ExternalLinkIcon } from "lucide-react";
import { Textarea } from "@nextui-org/react";
import { FormStatusButton } from "../../../../lib/components/form-status-button";
import { PlusIcon } from "lucide-react";

function UrlListItem({
    file,
    onDelete,
}: {
    file: WithStringId<z.infer<typeof DataSourceDoc>>,
    onDelete: (fileId: string) => Promise<void>;
}) {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDeleteClick = async () => {
        setIsDeleting(true);
        try {
            await onDelete(file._id);
        } finally {
            setIsDeleting(false);
        }
    };

    if (file.data.type !== 'url') {
        return null;
    }

    return (
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <div>
                <div className="flex items-center gap-2">
                    <p className="font-medium">{file.name}</p>
                    <div className="shrink-0">
                        <a href={file.data.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLinkIcon className="w-4 h-4" />
                        </a>
                    </div>
                </div>
            </div>
            <div className="flex gap-2 items-center">
                <button
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    className={`${isDeleting ? 'text-gray-400' : 'text-red-600 hover:text-red-800'}`}
                >
                    {isDeleting ? (
                        <Spinner size="sm" />
                    ) : (
                        'Delete'
                    )}
                </button>
            </div>
        </div>
    );
}

function UrlList({
    projectId,
    sourceId,
    onDelete,
}: {
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
        <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">URLs</h3>
            {loading && <div className="flex items-center justify-center gap-2">
                <Spinner size="sm" />
                <p>Loading list...</p>
            </div>}
            {!loading && files.length === 0 && <div className="flex items-center justify-center gap-2">
                <p>No files uploaded yet</p>
            </div>}
            {!loading && files.length > 0 && <div className="space-y-2">
                {files.map(file => (
                    <UrlListItem
                        key={file._id}
                        file={file}
                        onDelete={onDelete}
                    />
                ))}
                {totalPages > 1 && <Pagination
                    total={totalPages}
                    page={page}
                    onChange={setPage}
                />}
            </div>}
        </div>
    )
}

function AddUrls({
    projectId,
    sourceId,
    onAdd,
}: {
    projectId: string,
    sourceId: string,
    onAdd: () => void,
}) {
    const [isAdding, setIsAdding] = useState(false);
    const [showForm, setShowForm] = useState(false);

    async function handleSubmit(formData: FormData) {
        setIsAdding(true);
        try {
            const urls = formData.get('urls') as string;
            const urlsArray = urls.split('\n')
                .map(url => url.trim())
                .filter(url => url.length > 0);
            const first100Urls = urlsArray.slice(0, 100);
            
            await addDocsToDataSource({
                projectId,
                sourceId,
                docData: first100Urls.map(url => ({
                    name: url,
                    data: {
                        type: 'url',
                        url,
                    },
                })),
            });
            onAdd();
            setShowForm(false); // Hide form after successful submission
        } finally {
            setIsAdding(false);
        }
    }

    return (
        <div>
            {!showForm ? (
                <FormStatusButton
                    props={{
                        onClick: () => setShowForm(true),
                        children: "Add more URLs",
                        className: "self-start",
                        startContent: <PlusIcon className="w-[24px] h-[24px]" />,
                    }}
                />
            ) : (
                <div className="space-y-4">
                    <form action={handleSubmit} className="flex flex-col gap-4">
                        <Textarea
                            required
                            type="text"
                            name="urls"
                            label="Add more URLs (one per line)"
                            minRows={5}
                            maxRows={10}
                            labelPlacement="outside"
                            placeholder="https://example.com"
                            variant="bordered"
                        />
                        <div className="flex gap-2">
                            <FormStatusButton
                                props={{
                                    type: "submit",
                                    children: "Add URLs",
                                    className: "self-start",
                                    startContent: <PlusIcon className="w-[24px] h-[24px]" />,
                                    isLoading: isAdding,
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => setShowForm(false)}
                                className="text-gray-500 hover:text-gray-700"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
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
    dataSource: WithStringId<z.infer<typeof DataSource>>,
    handleReload: () => void;
}) {
    const [fileListKey, setFileListKey] = useState(0);

    async function handleRefresh() {
        await recrawlWebDataSource(projectId, dataSource._id);
        handleReload();
        setFileListKey(prev => prev + 1);
    }

    async function handleDelete(docId: string) {
        await deleteDocsFromDataSource({
            projectId,
            sourceId: dataSource._id,
            docIds: [docId],
        });
        handleReload();
        setFileListKey(prev => prev + 1);
    }

    return <>
        <PageSection title="Add URLs">
            <AddUrls
                projectId={projectId}
                sourceId={dataSource._id}
                onAdd={() => handleReload()}
            />
        </PageSection>
        <PageSection title="Index details">
            <UrlList
                projectId={projectId}
                sourceId={dataSource._id}
                onDelete={handleDelete}
            />
        </PageSection>
        {(dataSource.status === 'ready' || dataSource.status === 'error') && <PageSection title="Refresh">
            <div className="flex flex-col gap-2 items-start">
                <p>Scrape the URLs again to fetch updated content:</p>
                <Recrawl projectId={projectId} sourceId={dataSource._id} handleRefresh={handleRefresh} />
            </div>
        </PageSection>}
    </>;
}