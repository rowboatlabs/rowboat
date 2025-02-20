'use client';
import { WithStringId } from "../../../../lib/types/types";
import { DataSource } from "../../../../lib/types/datasource_types";
import { PageSection } from "../../../../lib/components/page-section";
import { ToggleSource } from "../toggle-source";
import { Spinner } from "@nextui-org/react";
import { SourceStatus } from "../source-status";
import { DeleteSource } from "./delete";
import { useEffect, useState } from "react";
import { DataSourceIcon } from "../../../../lib/components/datasource-icon";
import { z } from "zod";
import { TableLabel, TableValue } from "./shared";
import { ScrapeSource } from "./scrape-source";
import { FilesSource } from "./files-source";
import { getDataSource } from "../../../../actions/datasource_actions";

export function SourcePage({
    sourceId,
    projectId,
}: {
    sourceId: string;
    projectId: string;
}) {
    const [source, setSource] = useState<WithStringId<z.infer<typeof DataSource>> | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    async function handleReload() {
        setIsLoading(true);
        const updatedSource = await getDataSource(projectId, sourceId);
        setSource(updatedSource);
        setIsLoading(false);
    }

    // fetch source data first time
    useEffect(() => {
        let ignore = false;
        async function fetchSource() {
            setIsLoading(true);
            const source = await getDataSource(projectId, sourceId);
            if (!ignore) {
                setSource(source);
                setIsLoading(false);
            }
        }
        fetchSource();
        return () => {
            ignore = true;
        };
    }, [projectId, sourceId]);

    // refresh source data every 15 seconds
    // under certain conditions
    useEffect(() => {
        let ignore = false;
        let timeout: NodeJS.Timeout | null = null;

        if (!source) {
            return;
        }
        if (source.status !== 'pending') {
            return;
        }

        async function refresh() {
            if (timeout) {
                clearTimeout(timeout);
            }
            const updatedSource = await getDataSource(projectId, sourceId);
            if (!ignore) {
                setSource(updatedSource);
                timeout = setTimeout(refresh, 15 * 1000);
            }
        }
        timeout = setTimeout(refresh, 15 * 1000);

        return () => {
            ignore = true;
            if (timeout) {
                clearTimeout(timeout);
            }
        };
    }, [source, projectId, sourceId]);



    if (!source || isLoading) {
        return <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <div>Loading...</div>
        </div>
    }

    return <div className="flex flex-col h-full">
        <div className="shrink-0 flex justify-between items-center pb-4 border-b border-b-gray-100">
            <div className="flex flex-col">
                <h1 className="text-lg">{source.name}</h1>
            </div>
        </div>
        <div className="grow overflow-auto py-4">
            <div className="max-w-[768px] mx-auto">
                <PageSection title="Details">
                    <table className="table-auto">
                        <tbody>
                            <tr>
                                <TableLabel>Toggle:</TableLabel>
                                <TableValue>
                                    <ToggleSource projectId={projectId} sourceId={sourceId} active={source.active} />
                                </TableValue>
                            </tr>
                            <tr>
                                <TableLabel>Type:</TableLabel>
                                <TableValue>
                                    {source.data.type === 'urls' && <div className="flex gap-1 items-center">
                                        <DataSourceIcon type="urls" />
                                        <div>Specify URLs</div>
                                    </div>}
                                    {source.data.type === 'files' && <div className="flex gap-1 items-center">
                                        <DataSourceIcon type="files" />
                                        <div>File upload</div>
                                    </div>}
                                </TableValue>
                            </tr>
                            <tr>
                                <TableLabel>Source:</TableLabel>
                                <TableValue>
                                    <SourceStatus status={source.status} projectId={projectId} />
                                </TableValue>
                            </tr>
                        </tbody>
                    </table>
                </PageSection>
                {source.data.type === 'urls' && <ScrapeSource projectId={projectId} dataSource={source} handleReload={handleReload} />}
                {source.data.type === 'files' && <FilesSource projectId={projectId} dataSource={source} handleReload={handleReload} />}

                <PageSection title="Danger zone">
                    <div className="flex flex-col gap-2 items-start">
                        <p>Delete this data source:</p>
                        <DeleteSource projectId={projectId} sourceId={sourceId} />
                    </div>
                </PageSection>
            </div>
        </div>
    </div>;
}