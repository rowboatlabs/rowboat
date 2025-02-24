'use client';

import { Button, Link, Spinner } from "@nextui-org/react";
import { ToggleSource } from "./toggle-source";
import { SelfUpdatingSourceStatus } from "./self-updating-source-status";
import { DataSourceIcon } from "../../../lib/components/datasource-icon";
import { useEffect, useState } from "react";
import { WithStringId } from "../../../lib/types/types";
import { DataSource } from "../../../lib/types/datasource_types";
import { z } from "zod";
import { listDataSources } from "../../../actions/datasource_actions";

export function SourcesList({
    projectId,
}: {
    projectId: string;
}) {
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

    return <div className="flex flex-col h-full">
        <div className="shrink-0 flex justify-between items-center pb-4 border-b border-b-gray-100">
            <div className="flex flex-col">
                <h1 className="text-lg">Data sources <sup>(beta)</sup></h1>
            </div>
            <div className="flex items-center gap-2">
                <Button
                    href={`/projects/${projectId}/sources/new`}
                    as={Link}
                    startContent=<svg className="w-[24px] h-[24px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M5 12h14m-7 7V5" />
                    </svg>
                >
                    Add data source
                </Button>
            </div>
        </div>
        <div className="grow overflow-auto py-4">
            <div className="max-w-[768px] mx-auto">
                {loading && <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <div>Loading...</div>
                </div>}
                {!loading && !sources.length && <p className="mt-4 text-center">You have not added any data sources.</p>}
                {!loading && sources.length > 0 && <table className="w-full mt-2">
                    <thead className="pb-1 border-b border-b-gray-100">
                        <tr>
                            <th className="text-sm text-left font-medium text-gray-400">Name</th>
                            <th className="text-sm text-left font-medium text-gray-400">Type</th>
                            <th className="text-sm text-left font-medium text-gray-400">Status</th>
                            <th className="text-sm text-left font-medium text-gray-400"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sources.map((source) => {
                            return <tr key={source._id}>
                                <td className="py-4 text-left">
                                    <Link
                                        href={`/projects/${projectId}/sources/${source._id}`}
                                        size="lg"
                                        isBlock
                                    >
                                        {source.name}
                                    </Link>
                                </td>
                                <td className="py-4">
                                    {source.data.type == 'urls' && <div className="flex gap-1 items-center">
                                        <DataSourceIcon type="urls" />
                                        <div>List URLs</div>
                                    </div>}
                                </td>
                                <td className="py-4">
                                    <SelfUpdatingSourceStatus sourceId={source._id} projectId={projectId} initialStatus={source.status} compact={true} />
                                </td>
                                <td className="py-4 text-right">
                                    <ToggleSource projectId={projectId} sourceId={source._id} active={source.active} compact={true} className="bg-default-100" />
                                </td>
                            </tr>;
                        })}
                    </tbody>
                </table>}
            </div>
        </div>
    </div>;
} 