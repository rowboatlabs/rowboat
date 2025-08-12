'use client';

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@heroui/react";
import { Panel } from "@/components/common/panel-common";
import { fetchScheduledJobRule, enableScheduledJobRule, disableScheduledJobRule } from "@/app/actions/scheduled-job-rules.actions";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";
import { z } from "zod";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, PlayIcon, PauseIcon } from "lucide-react";
import { MessageDisplay } from "@/app/lib/components/message-display";

export function ScheduledJobRuleView({ projectId, ruleId }: { projectId: string; ruleId: string; }) {
    const [rule, setRule] = useState<z.infer<typeof ScheduledJobRule> | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [actionLoading, setActionLoading] = useState<boolean>(false);

    useEffect(() => {
        let ignore = false;
        (async () => {
            setLoading(true);
            const res = await fetchScheduledJobRule({ ruleId });
            if (ignore) return;
            setRule(res);
            setLoading(false);
        })();
        return () => { ignore = true; };
    }, [ruleId]);

    const title = useMemo(() => {
        if (!rule) return 'Scheduled Job Rule';
        return `Scheduled Job Rule ${rule.id}`;
    }, [rule]);

    const getStatusColor = (disabled: boolean, processedAt?: string) => {
        if (disabled) return 'text-gray-600 dark:text-gray-400';
        if (processedAt) return 'text-green-600 dark:text-green-400';
        return 'text-blue-600 dark:text-blue-400';
    };

    const getStatusText = (disabled: boolean, processedAt?: string) => {
        if (disabled) return 'Disabled';
        if (processedAt) return 'Completed';
        return 'Active';
    };

    const formatDateTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    const handleToggleStatus = async () => {
        if (!rule) return;
        
        setActionLoading(true);
        try {
            if (rule.disabled) {
                const updatedRule = await enableScheduledJobRule({ ruleId: rule.id });
                setRule(updatedRule);
            } else {
                const updatedRule = await disableScheduledJobRule({ ruleId: rule.id });
                setRule(updatedRule);
            }
        } catch (error) {
            console.error("Failed to toggle rule status:", error);
            alert("Failed to update rule status");
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    <Link href={`/projects/${projectId}/scheduled-job-rules`}>
                        <Button variant="secondary" size="sm">
                            <ArrowLeftIcon className="w-4 h-4 mr-2" />
                            Back
                        </Button>
                    </Link>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {title}
                    </div>
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    {rule && (
                        <Button
                            onClick={handleToggleStatus}
                            disabled={actionLoading}
                            variant={rule.disabled ? "primary" : "secondary"}
                            size="sm"
                            className="flex items-center gap-2"
                        >
                            {actionLoading ? (
                                <Spinner size="sm" />
                            ) : rule.disabled ? (
                                <>
                                    <PlayIcon className="w-4 h-4" />
                                    Enable
                                </>
                            ) : (
                                <>
                                    <PauseIcon className="w-4 h-4" />
                                    Disable
                                </>
                            )}
                        </Button>
                    )}
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
                    {!loading && rule && (
                        <div className="flex flex-col gap-6">
                            {/* Rule Metadata */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Rule ID:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">{rule.id}</span>
                                    </div>
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Status:</span>
                                        <span className={`ml-2 font-mono ${getStatusColor(rule.disabled, rule.processedAt)}`}>
                                            {getStatusText(rule.disabled, rule.processedAt)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Next Run:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                            {formatDateTime(rule.nextRunAt)}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="font-semibold text-gray-700 dark:text-gray-300">Created:</span>
                                        <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                            {formatDateTime(rule.createdAt)}
                                        </span>
                                    </div>
                                    {rule.processedAt && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Processed:</span>
                                            <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                                {formatDateTime(rule.processedAt)}
                                            </span>
                                        </div>
                                    )}
                                    {rule.jobId && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Job ID:</span>
                                            <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                                                <Link 
                                                    href={`/projects/${projectId}/jobs/${rule.jobId}`}
                                                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                                >
                                                    {rule.jobId}
                                                </Link>
                                            </span>
                                        </div>
                                    )}
                                    {rule.workerId && (
                                        <div>
                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Worker ID:</span>
                                            <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">{rule.workerId}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    Messages
                                </h3>
                                <div className="space-y-4">
                                    {rule.input.messages.map((message, index) => (
                                        <div key={index} className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                                            <MessageDisplay message={message} index={index} />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}
