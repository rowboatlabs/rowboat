'use client';

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@heroui/react";
import { Panel } from "@/components/common/panel-common";
import { fetchJob } from "@/app/actions/job_actions";
import { Job } from "@/src/entities/models/job";
import { z } from "zod";
import Link from "next/link";
import { MessageDisplay } from "../../../../lib/components/message-display";

export function JobView({ projectId, jobId }: { projectId: string; jobId: string; }) {
    const [job, setJob] = useState<z.infer<typeof Job> | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let ignore = false;
        (async () => {
            setLoading(true);
            const res = await fetchJob({ jobId });
            if (ignore) return;
            setJob(res);
            setLoading(false);
        })();
        return () => { ignore = true; };
    }, [jobId]);

    const title = useMemo(() => {
        if (!job) return 'Job';
        return `Job ${job.id}`;
    }, [job]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed':
                return 'text-green-600 dark:text-green-400';
            case 'failed':
                return 'text-red-600 dark:text-red-400';
            case 'running':
                return 'text-blue-600 dark:text-blue-400';
            case 'pending':
                return 'text-yellow-600 dark:text-yellow-400';
            default:
                return 'text-gray-600 dark:text-gray-400';
        }
    };

    // Extract conversation and turn IDs from job output
    const conversationId = job?.output?.conversationId;
    const turnId = job?.output?.turnId;

    return (
        <Panel
            title={<div className="flex items-center gap-3"><div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div></div>}
            rightActions={<div className="flex items-center gap-3"></div>}
        >
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[1024px] mx-auto">
                    {loading && (
                        <div className="flex items-center gap-2">
                            <Spinner size="sm" />
                            <div>Loading...</div>
                        </div>
                    )}
                    {!loading && job && (
                        <div className="flex flex-col gap-6">
                            {/* Job Metadata */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Job ID:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">{job.id}</span>
                                    </div>
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Status:</span>
                                        <span className={`ml-2 font-mono ${getStatusColor(job.status)}`}>
                                            {job.status}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Created:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                            {new Date(job.createdAt).toLocaleString()}
                                        </span>
                                    </div>
                                    {job.updatedAt && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Updated:</span>
                                            <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                                {new Date(job.updatedAt).toLocaleString()}
                                            </span>
                                        </div>
                                    )}
                                    {conversationId && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Conversation:</span>
                                            <Link
                                                href={`/projects/${projectId}/conversations/${conversationId}`}
                                                className="ml-2 font-mono text-blue-600 dark:text-blue-400 hover:underline"
                                            >
                                                {conversationId}
                                            </Link>
                                        </div>
                                    )}
                                    {turnId && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Turn:</span>
                                            <Link
                                                href={`/projects/${projectId}/conversations/${conversationId}#turn-${turnId}`}
                                                className="ml-2 font-mono text-blue-600 dark:text-blue-400 hover:underline"
                                            >
                                                {turnId}
                                            </Link>
                                        </div>
                                    )}
                                    {job.output?.error && (
                                        <div className="col-span-2">
                                            <span className="font-semibold text-red-700 dark:text-red-300">Error:</span>
                                            <span className="ml-2 font-mono text-red-600 dark:text-red-400">
                                                {job.output.error}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Job Input */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">
                                    Job Input
                                </div>
                                <div className="space-y-4">
                                    {/* Messages */}
                                    <div>
                                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
                                            Messages ({job.input.messages.length})
                                        </div>
                                        <div className="space-y-1">
                                            {job.input.messages.map((message, msgIndex) => (
                                                <MessageDisplay key={`input-${msgIndex}`} message={message} index={msgIndex} />
                                            ))}
                                        </div>
                                    </div>

                                    {/* Workflow */}
                                    <div>
                                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
                                            Workflow
                                        </div>
                                        <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto border border-gray-200 dark:border-gray-700 font-mono max-h-[400px]">
                                            {JSON.stringify(job.input.workflow, null, 2)}
                                        </pre>
                                    </div>
                                </div>
                            </div>

                            {/* Job Output */}
                            {job.output && (
                                <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wide">
                                        Job Output
                                    </div>
                                    <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto border border-gray-200 dark:border-gray-700 font-mono">
                                        {JSON.stringify(job.output, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                    {!loading && !job && (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <div className="text-sm font-mono">Job not found.</div>
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}
