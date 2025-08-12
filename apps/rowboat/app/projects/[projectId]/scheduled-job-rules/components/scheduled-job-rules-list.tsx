'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Spinner } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { listScheduledJobRules } from "@/app/actions/scheduled-job-rules.actions";
import { z } from "zod";
import { ListedRuleItem } from "@/src/application/repositories/scheduled-job-rules.repository.interface";
import { isToday, isThisWeek, isThisMonth } from "@/lib/utils/date";
import { PlusIcon } from "lucide-react";

type ListedItem = z.infer<typeof ListedRuleItem>;

export function ScheduledJobRulesList({ projectId }: { projectId: string }) {
    const [items, setItems] = useState<ListedItem[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [hasMore, setHasMore] = useState<boolean>(false);

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

    const loadMore = useCallback(async () => {
        if (!cursor) return;
        setLoadingMore(true);
        const res = await fetchPage(cursor);
        setItems(prev => [...prev, ...res.items]);
        setCursor(res.nextCursor);
        setHasMore(Boolean(res.nextCursor));
        setLoadingMore(false);
    }, [cursor, fetchPage]);

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

    const formatNextRunAt = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        SCHEDULED JOB RULES
                    </div>
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    <Link href={`/projects/${projectId}/scheduled-job-rules/new`}>
                        <Button size="sm" className="flex items-center gap-2">
                            <PlusIcon className="w-4 h-4" />
                            New Rule
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
                                                <Link
                                                    key={item.id}
                                                    href={`/projects/${projectId}/scheduled-job-rules/${item.id}`}
                                                    className="block p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex-1">
                                                            <div className="flex items-center gap-3 mb-2">
                                                                <span className={`text-sm font-medium ${getStatusColor(item.disabled, item.processedAt)}`}>
                                                                    {getStatusText(item.disabled, item.processedAt)}
                                                                </span>
                                                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                                                    Next run: {formatNextRunAt(item.nextRunAt)}
                                                                </span>
                                                            </div>
                                                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                                                Created: {new Date(item.createdAt).toLocaleDateString()}
                                                            </div>
                                                        </div>
                                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                                            {new Date(item.createdAt).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                            {items.length === 0 && !loading && (
                                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                                    No scheduled job rules found. Create your first rule to get started.
                                </div>
                            )}
                            {hasMore && (
                                <div className="text-center">
                                    <Button
                                        onClick={loadMore}
                                        disabled={loadingMore}
                                        variant="secondary"
                                        size="sm"
                                    >
                                        {loadingMore ? (
                                            <>
                                                <Spinner size="sm" />
                                                Loading...
                                            </>
                                        ) : (
                                            'Load More'
                                        )}
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
