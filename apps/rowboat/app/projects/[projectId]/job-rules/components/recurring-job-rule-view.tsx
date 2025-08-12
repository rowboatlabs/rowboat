'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { fetchRecurringJobRule, toggleRecurringJobRule } from "@/app/actions/recurring-job-rules.actions";
import { ArrowLeftIcon, PlayIcon, PauseIcon, ClockIcon, AlertCircleIcon } from "lucide-react";
import Link from "next/link";
import { RecurringJobRule } from "@/src/entities/models/recurring-job-rule";
import { Spinner } from "@heroui/react";
import { z } from "zod";

export function RecurringJobRuleView({ projectId, ruleId }: { projectId: string; ruleId: string }) {
    const router = useRouter();
    const [rule, setRule] = useState<z.infer<typeof RecurringJobRule> | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    useEffect(() => {
        const loadRule = async () => {
            try {
                const fetchedRule = await fetchRecurringJobRule({ ruleId });
                setRule(fetchedRule);
            } catch (error) {
                console.error("Failed to fetch rule:", error);
            } finally {
                setLoading(false);
            }
        };

        loadRule();
    }, [ruleId]);

    const handleToggleStatus = async () => {
        if (!rule) return;
        
        setUpdating(true);
        try {
            const updatedRule = await toggleRecurringJobRule({
                ruleId: rule.id,
                disabled: !rule.disabled,
            });
            setRule(updatedRule);
        } catch (error) {
            console.error("Failed to update rule:", error);
            alert("Failed to update rule status");
        } finally {
            setUpdating(false);
        }
    };

    const formatCronExpression = (cron: string) => {
        // Simple cron formatting for display
        const parts = cron.split(' ');
        if (parts.length === 5) {
            const [minute, hour, day, month, dayOfWeek] = parts;
            if (minute === '*' && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') {
                return 'Every minute';
            }
            if (minute === '0' && hour === '*' && day === '*' && month === '*' && dayOfWeek === '*') {
                return 'Every hour';
            }
            if (minute === '0' && hour === '0' && day === '*' && month === '*' && dayOfWeek === '*') {
                return 'Daily at midnight';
            }
            if (minute === '0' && hour === '0' && day === '1' && month === '*' && dayOfWeek === '*') {
                return 'Monthly on the 1st';
            }
            if (minute === '0' && hour === '0' && day === '*' && month === '*' && dayOfWeek === '0') {
                return 'Weekly on Sunday';
            }
        }
        return cron;
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    if (loading) {
        return (
            <Panel title="Loading...">
                <div className="flex items-center justify-center h-64">
                    <Spinner size="lg" />
                </div>
            </Panel>
        );
    }

    if (!rule) {
        return (
            <Panel title="Rule Not Found">
                <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400">The requested rule could not be found.</p>
                    <Link href={`/projects/${projectId}/job-rules`}>
                        <Button variant="secondary" className="mt-4">
                            Back to Job Rules
                        </Button>
                    </Link>
                </div>
            </Panel>
        );
    }

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    <Link href={`/projects/${projectId}/job-rules`}>
                        <Button variant="secondary" size="sm">
                            <ArrowLeftIcon className="w-4 h-4 mr-2" />
                            Back
                        </Button>
                    </Link>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        RECURRING JOB RULE
                    </div>
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    <Button
                        onClick={handleToggleStatus}
                        disabled={updating}
                        variant={rule.disabled ? "secondary" : "primary"}
                        size="sm"
                        className="flex items-center gap-2"
                    >
                        {updating ? (
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
                </div>
            }
        >
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[800px] mx-auto space-y-6">
                    {/* Status */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <div className={`w-3 h-3 rounded-full ${rule.disabled ? 'bg-red-500' : 'bg-green-500'}`} />
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                Status: {rule.disabled ? 'Disabled' : 'Active'}
                            </span>
                        </div>
                        {rule.lastError && (
                            <div className="flex items-start gap-2 mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                                <AlertCircleIcon className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <div className="text-sm text-red-700 dark:text-red-300">
                                    <strong>Last Error:</strong> {rule.lastError}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Schedule Information */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-3">
                            Schedule Information
                        </h3>
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <ClockIcon className="w-4 h-4 text-gray-500" />
                                <span className="text-sm text-gray-600 dark:text-gray-400">Cron Expression:</span>
                                <code className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-sm font-mono">
                                    {rule.cron}
                                </code>
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                <strong>Human Readable:</strong> {formatCronExpression(rule.cron)}
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                <strong>Next Run:</strong> {formatDate(rule.nextRunAt)}
                            </div>
                            {rule.lastProcessedAt && (
                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                    <strong>Last Processed:</strong> {formatDate(rule.lastProcessedAt)}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-3">
                            Messages
                        </h3>
                        <div className="space-y-3">
                            {rule.input.messages.map((message, index) => (
                                <div key={index} className="border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                                            message.role === 'system' 
                                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                                                : message.role === 'user'
                                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                                : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                        }`}>
                                            {message.role.charAt(0).toUpperCase() + message.role.slice(1)}
                                        </span>
                                    </div>
                                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                        {message.content}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Metadata */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-3">
                            Metadata
                        </h3>
                        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                            <div><strong>Created:</strong> {formatDate(rule.createdAt)}</div>
                            {rule.updatedAt && (
                                <div><strong>Last Updated:</strong> {formatDate(rule.updatedAt)}</div>
                            )}
                            <div><strong>Rule ID:</strong> <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{rule.id}</code></div>
                        </div>
                    </div>
                </div>
            </div>
        </Panel>
    );
}
