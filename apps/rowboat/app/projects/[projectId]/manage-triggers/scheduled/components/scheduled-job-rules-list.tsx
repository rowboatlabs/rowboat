'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Spinner } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { listScheduledJobRules, deleteScheduledJobRule } from "@/app/actions/scheduled-job-rules.actions";
import { z } from "zod";
import { ListedRuleItem } from "@/src/application/repositories/scheduled-job-rules.repository.interface";
import { isToday, isThisWeek, isThisMonth } from "@/lib/utils/date";
import { PlusIcon, Trash2 } from "lucide-react";
import { CreateScheduledJobRuleForm } from "./create-scheduled-job-rule-form";

type ListedItem = z.infer<typeof ListedRuleItem>;

export function ScheduledJobRulesList({ projectId }: { projectId: string }) {
    const [items, setItems] = useState<ListedItem[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [hasMore, setHasMore] = useState<boolean>(false);
    const [deletingRule, setDeletingRule] = useState<string | null>(null);
    const [showCreateFlow, setShowCreateFlow] = useState(false);

    const fetchPage = useCallback(async (cursorArg?: string | null) => {
        const res = await listScheduledJobRules({ projectId, cursor: cursorArg ?? undefined, limit: 20 });
        return res;
    }, [projectId]);

    useEffect(() => {
        let ignore = false;
        (async () => {
            setLoading(true);
            const res = await fetchPage(null);
            if (ignore) return;
            setItems(res.items);
            setCursor(res.nextCursor);
            setHasMore(Boolean(res.nextCursor));
            setLoading(false);
        })();
        return () => { ignore = true; };
    }, [fetchPage]);

    useEffect(() => {
        if (!loading && items.length === 0 && !showCreateFlow) {
            setShowCreateFlow(true);
        }
    }, [loading, items.length, showCreateFlow]);

    const loadMore = useCallback(async () => {
        if (!cursor) return;
        setLoadingMore(true);
        const res = await fetchPage(cursor);
        setItems(prev => [...prev, ...res.items]);
        setCursor(res.nextCursor);
        setHasMore(Boolean(res.nextCursor));
        setLoadingMore(false);
    }, [cursor, fetchPage]);

    const handleDeleteRule = async (ruleId: string) => {
        if (!window.confirm('Are you sure you want to delete this one-time trigger?')) {
            return;
        }

        try {
            setDeletingRule(ruleId);
            await deleteScheduledJobRule({ projectId, ruleId });
            // Remove the deleted item from the list
            setItems(prev => prev.filter(item => item.id !== ruleId));
        } catch (err: any) {
            console.error('Error deleting one-time trigger:', err);
            alert('Failed to delete one-time trigger. Please try again.');
        } finally {
            setDeletingRule(null);
        }
    };

    const handleCreateNew = () => {
        setShowCreateFlow(true);
    };

    const handleBackToList = () => {
        setShowCreateFlow(false);
        // Reload the list to show any newly created triggers
        const loadTriggers = async () => {
            try {
                setLoading(true);
                const response = await fetchPage(null);
                setItems(response.items);
                setCursor(response.nextCursor);
                setHasMore(Boolean(response.nextCursor));
            } catch (err: any) {
                console.error('Error loading triggers:', err);
            } finally {
                setLoading(false);
            }
        };
        loadTriggers();
    };

    const sections = useMemo(() => {
        const groups: Record<string, ListedItem[]> = {
            Today: [],
            'This week': [],
            'This month': [],
            Older: [],
        };
        for (const item of items) {
            const d = new Date(item.nextRunAt);
            if (isToday(d)) groups['Today'].push(item);
            else if (isThisWeek(d)) groups['This week'].push(item);
            else if (isThisMonth(d)) groups['This month'].push(item);
            else groups['Older'].push(item);
        }
        return groups;
    }, [items]);

    const getStatusColor = (status: string, processedAt: string | null) => {
        if (processedAt) return 'text-green-600 dark:text-green-400';
        if (status === 'processing') return 'text-yellow-600 dark:text-yellow-400';
        if (status === 'triggered') return 'text-blue-600 dark:text-blue-400';
        return 'text-gray-600 dark:text-gray-400'; // pending
    };

    const getStatusText = (status: string, processedAt: string | null) => {
        if (processedAt) return 'Completed';
        if (status === 'processing') return 'Processing';
        if (status === 'triggered') return 'Triggered';
        return 'Pending';
    };

    const formatNextRunAt = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    if (showCreateFlow) {
        return <CreateScheduledJobRuleForm projectId={projectId} onBack={handleBackToList} />;
    }

    return (
        <Panel
            title={
                <div className="text-base font-normal text-gray-900 dark:text-gray-100">
                    Schedule a single job to run your assistant workflow at a specific date and time.
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    <Button size="sm" className="whitespace-nowrap" startContent={<PlusIcon className="w-4 h-4" />} onClick={handleCreateNew}>
                        New One-time Trigger
                    </Button>
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
                    {!loading && (
                        <div className="flex flex-col gap-6">
                            {Object.entries(sections).map(([sectionName, sectionItems]) => {
                                if (sectionItems.length === 0) return null;
                                return (
                                    <div key={sectionName} className="space-y-3">
                                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                                            {sectionName}
                                        </h3>
                                        <div className="grid gap-3">
                                            {sectionItems.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <Link
                                                                href={`/projects/${projectId}/manage-triggers/scheduled/${item.id}`}
                                                                className="block"
                                                            >
                                                                <div className="flex items-center gap-3 mb-2">
                                                                    <span className={`text-sm font-medium ${getStatusColor(item.status, item.processedAt || null)}`}>
                                                                        {getStatusText(item.status, item.processedAt || null)}
                                                                    </span>
                                                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                                                        Next run: {formatNextRunAt(item.nextRunAt)}
                                                                    </span>
                                                                </div>
                                                                <div className="text-sm text-gray-600 dark:text-gray-400">
                                                                    Created: {new Date(item.createdAt).toLocaleDateString()}
                                                                </div>
                                                            </Link>
                                                        </div>
                                                        <Button
                                                            variant="tertiary"
                                                            size="sm"
                                                            isLoading={deletingRule === item.id}
                                                            onClick={() => handleDeleteRule(item.id)}
                                                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            {items.length === 0 && !loading && (
                                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                    No one-time triggers yet. Create your first one-time trigger to get started.
                                </div>
                            )}
                            {hasMore && (
                                <div className="text-center">
                                    <Button
                                        onClick={loadMore}
                                        disabled={loadingMore}
                                        variant="secondary"
                                        size="sm"
                                        isLoading={loadingMore}
                                        className="whitespace-nowrap"
                                    >
                                        {loadingMore ? 'Loading...' : 'Load More'}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}

