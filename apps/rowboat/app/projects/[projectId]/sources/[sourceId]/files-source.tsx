"use client";
import { PageSection } from "../../../../lib/components/page-section";
import { WithStringId } from "../../../../lib/types/types";
import { DataSourceDoc } from "../../../../lib/types/datasource_types";
import { DataSource } from "../../../../lib/types/datasource_types";
import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { deleteDocsFromDataSource, getUploadUrlsForFilesDataSource, addDocsToDataSource, getDownloadUrlForFile, listDocsInDataSource } from "../../../../actions/datasource_actions";
import { RelativeTime } from "@primer/react";
import { Pagination, Spinner } from "@nextui-org/react";
import { DownloadIcon } from "lucide-react";

function FileListItem({
    projectId,
    sourceId,
    file,
    onDelete,
}: {
    projectId: string,
    sourceId: string,
    file: WithStringId<z.infer<typeof DataSourceDoc>>,
    onDelete: (fileId: string) => Promise<void>;
}) {
    const [isDeleting, setIsDeleting] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDeleteClick = async () => {
        setIsDeleting(true);
        try {
            await onDelete(file._id);
        } finally {
            setIsDeleting(false);
        }
    };

    const handleDownloadClick = async () => {
        setIsDownloading(true);
        try {
            const url = await getDownloadUrlForFile(projectId, sourceId, file._id);
            window.open(url, '_blank');
        } catch (error) {
            console.error('Download failed:', error);
            // TODO: Add error handling
        } finally {
            setIsDownloading(false);
        }
    };

    if (file.data.type !== 'file') {
        return null;
    }

    return (
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded">
            <div>
                <div className="flex items-center gap-2">
                    <p className="font-medium">{file.name}</p>
                    <div className="shrink-0">
                        {isDownloading ? (
                            <Spinner size="sm" />
                        ) : (
                            <button
                                onClick={handleDownloadClick}
                                className={`shrink-0 text-gray-500 hover:text-gray-700`}
                            >
                                <DownloadIcon className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-sm text-gray-500">
                    uploaded <RelativeTime date={new Date(file.createdAt)} /> - {formatFileSize(file.data.size)}
                </p>
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

function PaginatedFileList({
    projectId,
    sourceId,
    handleReload,
    onDelete,
}: {
    projectId: string,
    sourceId: string,
    handleReload: () => void;
    onDelete: (fileId: string) => Promise<void>;
}) {
    const [files, setFiles] = useState<WithStringId<z.infer<typeof DataSourceDoc>>[]>([]);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);

    const totalPages = Math.ceil(total / 10);

    useEffect(() => {
        let ignore = false;

        async function fetchFiles() {
            setLoading(true);
            try {
                const { files, total } = await listDocsInDataSource({
                    projectId,
                    sourceId,
                    page,
                    limit: 10,
                });
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
        }
    }, [projectId, sourceId, page]);

    return (
        <div className="mt-6">
            <h3 className="text-lg font-semibold mb-3">Uploaded Files</h3>
            {loading && <div className="flex items-center justify-center gap-2">
                <Spinner size="sm" />
                <p>Loading list...</p>
            </div>}
            {!loading && files.length === 0 && <div className="flex items-center justify-center gap-2">
                <p>No files uploaded yet</p>
            </div>}
            {!loading && files.length > 0 && <div className="space-y-2">
                {files.map(file => (
                    <FileListItem
                        key={file._id}
                        file={file}
                        projectId={projectId}
                        sourceId={sourceId}
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

export function FilesSource({
    projectId,
    dataSource,
    handleReload,
}: {
    projectId: string,
    dataSource: WithStringId<z.infer<typeof DataSource>>,
    handleReload: () => void;
}) {
    const [uploading, setUploading] = useState(false);
    const [fileListKey, setFileListKey] = useState(0);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setUploading(true);
        try {
            const urls = await getUploadUrlsForFilesDataSource(projectId, dataSource._id, acceptedFiles.map(file => ({
                name: file.name,
                type: file.type,
                size: file.size,
            })));

            // Upload files in parallel
            await Promise.all(acceptedFiles.map(async (file, index) => {
                await fetch(urls[index].presignedUrl, {
                    method: 'PUT',
                    body: file,
                    headers: {
                        'Content-Type': file.type,
                    },
                });
            }));

            // After successful uploads, update the database with file information
            await addDocsToDataSource({
                projectId,
                sourceId: dataSource._id,
                docData: acceptedFiles.map((file, index) => ({
                    _id: urls[index].fileId,
                    name: file.name,
                    data: {
                        type: 'file',
                        name: file.name,
                        size: file.size,
                        mimeType: file.type,
                        s3Key: urls[index].s3Key,
                    },
                })),
            });

            handleReload();
            setFileListKey(prev => prev + 1);
        } catch (error) {
            console.error('Upload failed:', error);
            // TODO: Add error handling
        } finally {
            setUploading(false);
        }
    }, [projectId, dataSource._id, handleReload]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        disabled: uploading,
        accept: {
            'application/pdf': ['.pdf'],
            'text/plain': ['.txt'],
            'application/msword': ['.doc'],
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    });

    const handleDelete = async (docId: string) => {
        await deleteDocsFromDataSource({
            projectId,
            sourceId: dataSource._id,
            docIds: [docId],
        });
        handleReload();
        setFileListKey(fileListKey + 1);
    };

    return (
        <PageSection title="Upload files">
            <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                    ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
            >
                <input {...getInputProps()} />
                {uploading ? (
                    <div className="flex items-center justify-center gap-2">
                        <Spinner size="sm" />
                        <p>Uploading files...</p>
                    </div>
                ) : isDragActive ? (
                    <p>Drop the files here...</p>
                ) : (
                    <div>
                        <p>Drag and drop files here, or click to select files</p>
                        <p className="text-sm text-gray-500">
                            Supported file types: PDF, TXT, DOC, DOCX
                        </p>
                    </div>
                )}
            </div>

            <PaginatedFileList
                key={fileListKey}
                projectId={projectId}
                sourceId={dataSource._id}
                handleReload={handleReload}
                onDelete={handleDelete}
            />
        </PageSection>
    );
}

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}