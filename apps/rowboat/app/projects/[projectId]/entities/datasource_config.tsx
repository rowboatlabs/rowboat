"use client";
import { WithStringId } from "../../../lib/types/types";
import { DataSource } from "../../../lib/types/datasource_types";
import { z } from "zod";
import { XIcon, FileIcon, FilesIcon, FileTextIcon, GlobeIcon, AlertTriangle, CheckCircle, Clock, Circle } from "lucide-react";
import { useState, useEffect } from "react";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { DataSourceIcon } from "@/app/lib/components/datasource-icon";
import { Tooltip } from "@heroui/react";
import { getDataSource } from "@/app/actions/datasource_actions";

export function DataSourceConfig({
    dataSourceId,
    handleClose
}: {
    dataSourceId: string,
    handleClose: () => void
}) {
    const [dataSource, setDataSource] = useState<WithStringId<z.infer<typeof DataSource>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadDataSource() {
            try {
                setLoading(true);
                // Extract projectId from the current URL
                const pathParts = window.location.pathname.split('/');
                const projectId = pathParts[2]; // /projects/[projectId]/workflow
                
                const ds = await getDataSource(projectId, dataSourceId);
                setDataSource(ds);
            } catch (err) {
                console.error('Failed to load data source:', err);
                setError('Failed to load data source details');
            } finally {
                setLoading(false);
            }
        }

        loadDataSource();
    }, [dataSourceId]);

    if (loading) {
        return (
            <Panel
                title={
                    <div className="flex items-center justify-between w-full">
                        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            Loading Data Source...
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleClose}
                            showHoverContent={true}
                            hoverContent="Close"
                        >
                            <XIcon className="w-4 h-4" />
                        </Button>
                    </div>
                }
            >
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            </Panel>
        );
    }

    if (error || !dataSource) {
        return (
            <Panel
                title={
                    <div className="flex items-center justify-between w-full">
                        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            Error Loading Data Source
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleClose}
                            showHoverContent={true}
                            hoverContent="Close"
                        >
                            <XIcon className="w-4 h-4" />
                        </Button>
                    </div>
                }
            >
                <div className="flex items-center justify-center h-64 text-red-500">
                    <div className="text-center">
                        <AlertTriangle className="w-12 h-12 mx-auto mb-4" />
                        <p>{error || 'Data source not found'}</p>
                    </div>
                </div>
            </Panel>
        );
    }

    // Determine status
    const isActive = dataSource.active && dataSource.status === 'ready';
    const isPending = dataSource.status === 'pending';
    const isError = dataSource.status === 'error';

    // Status indicator
    const statusIndicator = () => {
        if (isPending) {
            return (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium">Processing</span>
                </div>
            );
        } else if (isError) {
            return (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Error</span>
                </div>
            );
        } else if (isActive) {
            return (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Active</span>
                </div>
            );
        } else {
            return (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-50 text-gray-700 dark:bg-gray-900/20 dark:text-gray-400">
                    <Circle className="w-4 h-4" />
                    <span className="text-sm font-medium">Inactive</span>
                </div>
            );
        }
    };

    // Type display name
    const getTypeDisplayName = (type: string) => {
        switch (type) {
            case 'urls': return 'Scraped URLs';
            case 'files_local': return 'Local Files';
            case 'files_s3': return 'S3 Files';
            case 'text': return 'Text Content';
            default: return type;
        }
    };

    return (
        <Panel
            title={
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                        <DataSourceIcon 
                            type={
                                dataSource.data.type === 'files_local' || dataSource.data.type === 'files_s3' 
                                    ? 'files' 
                                    : dataSource.data.type
                            } 
                            size="md" 
                        />
                        <div>
                            <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                                {dataSource.name}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                                Data Source
                            </div>
                        </div>
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleClose}
                        showHoverContent={true}
                        hoverContent="Close"
                    >
                        <XIcon className="w-4 h-4" />
                    </Button>
                </div>
            }
        >
            <div className="h-full overflow-auto">
                <div className="p-6 space-y-6">
                    {/* Status Section */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Status</h3>
                        {statusIndicator()}
                        {isError && dataSource.error && (
                            <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-md">
                                <p className="text-sm text-red-700 dark:text-red-400">{dataSource.error}</p>
                            </div>
                        )}
                    </div>

                    {/* Basic Information */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Information</h3>
                        <div className="grid grid-cols-1 gap-4 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Type:</span>
                                <span className="text-gray-900 dark:text-gray-100">{getTypeDisplayName(dataSource.data.type)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Created:</span>
                                <span className="text-gray-900 dark:text-gray-100">
                                    {new Date(dataSource.createdAt).toLocaleDateString()}
                                </span>
                            </div>
                            {dataSource.lastUpdatedAt && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500 dark:text-gray-400">Last Updated:</span>
                                    <span className="text-gray-900 dark:text-gray-100">
                                        {new Date(dataSource.lastUpdatedAt).toLocaleDateString()}
                                    </span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-500 dark:text-gray-400">Version:</span>
                                <span className="text-gray-900 dark:text-gray-100">{dataSource.version}</span>
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    {dataSource.description && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Description</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
                                {dataSource.description}
                            </p>
                        </div>
                    )}

                    {/* Usage Information */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Usage</h3>
                        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                            <div className="flex items-start gap-3">
                                <div className="w-5 h-5 text-blue-500 mt-0.5">
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div className="text-sm text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">Using this data source</p>
                                    <p>To use this data source in your agents, go to the RAG tab in individual agent settings and connect this data source.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Panel>
    );
}