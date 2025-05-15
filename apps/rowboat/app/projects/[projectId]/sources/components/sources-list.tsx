'use client';

import { Link, Spinner } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { ToggleSource } from "./toggle-source";
import { SelfUpdatingSourceStatus } from "./self-updating-source-status";
import { DataSourceIcon } from "../../../../lib/components/datasource-icon";
import { useEffect, useState } from "react";
import { WithStringId } from "../../../../lib/types/types";
import { DataSource } from "../../../../lib/types/datasource_types";
import { z } from "zod";
import { listDataSources } from "../../../../actions/datasource_actions";
import { Panel } from "@/components/common/panel-common";
import { PlusIcon } from "lucide-react";

export function SourcesList({ projectId }: { projectId: string }) {
    const [sources, setSources] = useState<WithStringId<z.infer<typeof DataSource>>[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let ignore = false;

        async function fetchSources() {
            setLoading(true);
            const sources = await listDataSources(projectId);
            if (!ignore) {
                setSources(sources);
                setLoading(false);
            }
        }
        fetchSources();

        return () => {
            ignore = true;
        };
    }, [projectId]);

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        DATA SOURCES
                    </div>
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    <Link href={`/projects/${projectId}/sources/new`}>
                        <Button
                            variant="primary"
                            size="sm"
                            className="bg-blue-50 text-blue-700 hover:bg-blue-100"
                            startContent={<PlusIcon className="w-4 h-4" />}
                        >
                            Add data source
                        </Button>
                    </Link>
                </div>
            }
        >
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[1024px] mx-auto">
                    {loading && (
                        <div className="flex items-center gap-2">
                            <Spinner size="sm" />
                            <div>Loading...</div>
                        </div>
                    )}
                    {!loading && !sources.length && (
                        <p className="mt-4 text-center">You have not added any data sources.</p>
                    )}
                    {!loading && sources.length > 0 && (
                        <>
                            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-200 dark:border-blue-800">
                                <div className="flex items-start gap-3">
                                    <svg 
                                        className="w-5 h-5 text-blue-500 mt-0.5" 
                                        fill="none" 
                                        stroke="currentColor" 
                                        viewBox="0 0 24 24"
                                    >
                                        <path 
                                            strokeLinecap="round" 
                                            strokeLinejoin="round" 
                                            strokeWidth={2} 
                                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
                                        />
                                    </svg>
                                    <div className="text-sm text-blue-700 dark:text-blue-300">
                                        After creating data sources, go to the RAG tab inside individual agent settings to connect them to agents.
                                    </div>
                                </div>
                            </div>
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full">
                                    <thead className="bg-gray-50 dark:bg-gray-800/50">
                                        <tr>
                                            <th className="w-[30%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                Name
                                            </th>
                                            <th className="w-[20%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                Type
                                            </th>
                                            {sources.some(source => source.status) && (
                                                <th className="w-[35%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                    Status
                                                </th>
                                            )}
                                            <th className="w-[15%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                                Active
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                        {sources.map((source) => (
                                            <tr 
                                                key={source._id}
                                                className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                                            >
                                                <td className="px-6 py-4 text-left">
                                                    <Link
                                                        href={`/projects/${projectId}/sources/${source._id}`}
                                                        size="lg"
                                                        isBlock
                                                        className="text-sm text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 truncate block"
                                                    >
                                                        {source.name}
                                                    </Link>
                                                </td>
                                                <td className="px-6 py-4 text-left">
                                                    {source.data.type == 'urls' && (
                                                        <div className="flex gap-2 items-center text-sm text-gray-600 dark:text-gray-300">
                                                            <DataSourceIcon type="urls" />
                                                            <div>List URLs</div>
                                                        </div>
                                                    )}
                                                    {source.data.type == 'text' && (
                                                        <div className="flex gap-2 items-center text-sm text-gray-600 dark:text-gray-300">
                                                            <DataSourceIcon type="text" />
                                                            <div>Text</div>
                                                        </div>
                                                    )}
                                                    {source.data.type == 'files_local' && (
                                                        <div className="flex gap-2 items-center text-sm text-gray-600 dark:text-gray-300">
                                                            <DataSourceIcon type="files" />
                                                            <div>Files (Local)</div>
                                                        </div>
                                                    )}
                                                    {source.data.type == 'files_s3' && (
                                                        <div className="flex gap-2 items-center text-sm text-gray-600 dark:text-gray-300">
                                                            <DataSourceIcon type="files" />
                                                            <div>Files (S3)</div>
                                                        </div>
                                                    )}
                                                </td>
                                                {sources.some(source => source.status) && (
                                                    <td className="px-6 py-4 text-left">
                                                        <div className="text-sm">
                                                            <SelfUpdatingSourceStatus 
                                                                sourceId={source._id} 
                                                                projectId={projectId} 
                                                                initialStatus={source.status} 
                                                                compact={true} 
                                                            />
                                                        </div>
                                                    </td>
                                                )}
                                                <td className="px-6 py-4 text-left">
                                                    <ToggleSource 
                                                        projectId={projectId} 
                                                        sourceId={source._id} 
                                                        active={source.active} 
                                                        compact={true} 
                                                        className="bg-default-100" 
                                                    />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </Panel>
    );
} 