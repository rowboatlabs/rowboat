'use client';
import { WithStringId } from "../../../../lib/types/types";
import { DataSource } from "../../../../lib/types/datasource_types";
import { ToggleSource } from "../components/toggle-source";
import { Spinner } from "@heroui/react";
import { SourceStatus } from "../components/source-status";
import { DeleteSource } from "../components/delete";
import { useEffect, useState } from "react";
import { DataSourceIcon } from "../../../../lib/components/datasource-icon";
import { z } from "zod";
import { ScrapeSource } from "../components/scrape-source";
import { FilesSource } from "../components/files-source";
import { getDataSource, updateDataSource } from "../../../../actions/datasource_actions";
import { TextSource } from "../components/text-source";
import { Panel } from "@/components/common/panel-common";
import { Section, SectionRow, SectionLabel, SectionContent } from "../components/section";
import Link from "next/link";
import { BackIcon } from "../../../../lib/components/icons";
import { Textarea } from "@/components/ui/textarea";
import { CheckIcon } from "lucide-react";

export function SourcePage({
    sourceId,
    projectId,
}: {
    sourceId: string;
    projectId: string;
}) {
    const [source, setSource] = useState<WithStringId<z.infer<typeof DataSource>> | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);

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
        return (
            <div className="flex items-center gap-2 p-4">
                <Spinner size="sm" />
                <div>Loading...</div>
            </div>
        );
    }

    return (
        <Panel title={source.name.toUpperCase()}>
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[768px] mx-auto space-y-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Link 
                            href={`/projects/${projectId}/sources`}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                        >
                            <BackIcon size={16} />
                            <span>Back to sources</span>
                        </Link>
                    </div>
                    <Section
                        title="Details"
                        description="Basic information about this data source."
                    >
                        <div className="space-y-4">
                            <SectionRow>
                                <SectionLabel>Toggle</SectionLabel>
                                <SectionContent>
                                    <ToggleSource 
                                        projectId={projectId} 
                                        sourceId={sourceId} 
                                        active={source.active} 
                                    />
                                </SectionContent>
                            </SectionRow>
                            
                            <SectionRow>
                                <SectionLabel>Name</SectionLabel>
                                <SectionContent>
                                    <div className="text-sm text-gray-900 dark:text-gray-100">
                                        {source.name}
                                    </div>
                                </SectionContent>
                            </SectionRow>

                            <SectionRow>
                                <SectionLabel className="pt-3">Description</SectionLabel>
                                <SectionContent>
                                    <form
                                        action={async (formData: FormData) => {
                                            const description = formData.get('description') as string;
                                            await updateDataSource({
                                                projectId,
                                                sourceId,
                                                description,
                                            });
                                            handleReload();
                                            setShowSaveSuccess(true);
                                            setTimeout(() => setShowSaveSuccess(false), 2000);
                                        }}
                                        className="w-full"
                                    >
                                        <Textarea
                                            name="description"
                                            defaultValue={source.description || ''}
                                            placeholder="Add a description for this data source"
                                            rows={2}
                                            className="w-full rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                                        />
                                        <div className="flex items-center gap-2 mt-2">
                                            <button
                                                type="submit"
                                                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                            >
                                                Save
                                            </button>
                                            {showSaveSuccess && (
                                                <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                                                    <CheckIcon className="w-4 h-4" />
                                                    <span>Saved</span>
                                                </div>
                                            )}
                                        </div>
                                    </form>
                                </SectionContent>
                            </SectionRow>

                            <SectionRow>
                                <SectionLabel>Type</SectionLabel>
                                <SectionContent>
                                    <div className="flex gap-2 items-center text-sm text-gray-900 dark:text-gray-100">
                                        {source.data.type === 'urls' && <>
                                            <DataSourceIcon type="urls" />
                                            <div>Specify URLs</div>
                                        </>}
                                        {source.data.type === 'files_local' && <>
                                            <DataSourceIcon type="files" />
                                            <div>File upload (local)</div>
                                        </>}
                                        {source.data.type === 'files_s3' && <>
                                            <DataSourceIcon type="files" />
                                            <div>File upload (S3)</div>
                                        </>}
                                        {source.data.type === 'text' && <>
                                            <DataSourceIcon type="text" />
                                            <div>Text</div>
                                        </>}
                                    </div>
                                </SectionContent>
                            </SectionRow>

                            {/* Only show status when it exists */}
                            {source.status && (
                                <SectionRow>
                                    <SectionLabel>Status</SectionLabel>
                                    <SectionContent>
                                        <SourceStatus status={source.status} projectId={projectId} />
                                    </SectionContent>
                                </SectionRow>
                            )}
                        </div>
                    </Section>

                    {/* Source-specific sections */}
                    {source.data.type === 'urls' && 
                        <ScrapeSource 
                            projectId={projectId} 
                            dataSource={source} 
                            handleReload={handleReload} 
                        />
                    }
                    {(source.data.type === 'files_local' || source.data.type === 'files_s3') && 
                        <FilesSource 
                            projectId={projectId} 
                            dataSource={source} 
                            handleReload={handleReload} 
                            type={source.data.type}
                        />
                    }
                    {source.data.type === 'text' && 
                        <TextSource 
                            projectId={projectId} 
                            dataSource={source} 
                            handleReload={handleReload} 
                        />
                    }

                    <Section
                        title="Danger Zone"
                        description="Permanently delete this data source."
                    >
                        <div className="space-y-4">
                            <div className="p-4 bg-red-50/10 dark:bg-red-900/10 rounded-lg">
                                <p className="text-sm text-red-700 dark:text-red-300">
                                    Deleting this data source will permanently remove all its content.
                                    This action cannot be undone.
                                </p>
                            </div>
                            <DeleteSource projectId={projectId} sourceId={sourceId} />
                        </div>
                    </Section>
                </div>
            </div>
        </Panel>
    );
}