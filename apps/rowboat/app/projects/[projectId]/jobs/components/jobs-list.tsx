'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Spinner } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { listJobs } from "@/app/actions/job_actions";
import { z } from "zod";
import { ListedJobItem } from "@/src/application/repositories/jobs.repository.interface";
import { isToday, isThisWeek, isThisMonth } from "@/lib/utils/date";

type ListedItem = z.infer<typeof ListedJobItem>;

export function JobsList({ projectId }: { projectId: string }) {
    const [items, setItems] = useState<ListedItem[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [hasMore, setHasMore] = useState<boolean>(false);

    const fetchPage = useCallback(async (cursorArg?: string | null) => {
        const res = await listJobs({ projectId, cursor: cursorArg ?? undefined, limit: 20 });
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
            const d = new Date(item.createdAt);
            if (isToday(d)) groups['Today'].push(item);
            else if (isThisWeek(d)) groups['This week'].push(item);
            else if (isThisMonth(d)) groups['This month'].push(item);
            else groups['Older'].push(item);
        }
        return groups;
    }, [items]);

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

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        JOBS
                    </div>
                </div>
            }
            rightActions={
                <div className="flex items-center gap-3">
                    {/* Reserved for future actions */}
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
                    {!loading && items.length === 0 && (
                        <p className="mt-4 text-center">No jobs yet.</p>
                    )}
                    {!loading && items.length > 0 && (
                        <div className="flex flex-col gap-8">
                            {Object.entries(sections).map(([label, group]) => (
                                group.length > 0 ? (
                                    <div key={label}>
                                        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3">{label}</div>
                                        <div className="border rounded-lg overflow-hidden">
                                            <table className="w-full">
                                                <thead className="bg-gray-50 dark:bg-gray-800/50">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Job</th>
                                                        <th className="w-[20%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                                                        <th className="w-[30%] px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Created</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                                    {group.map((job) => (
                                                        <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                                                            <td className="px-6 py-4 text-left">
                                                                <Link
                                                                    href={`/projects/${projectId}/jobs/${job.id}`}
                                                                    size="lg"
                                                                    isBlock
                                                                    className="text-sm text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 truncate block"
                                                                >
                                                                    {job.id}
                                                                </Link>
                                                            </td>
                                                            <td className="px-6 py-4 text-left">
                                                                <span className={`text-sm font-medium ${getStatusColor(job.status)}`}>
                                                                    {job.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-6 py-4 text-left text-sm text-gray-600 dark:text-gray-300">
                                                                {new Date(job.createdAt).toLocaleString()}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : null
                            ))}
                            {hasMore && (
                                <div className="flex justify-center">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={loadMore}
                                        disabled={loadingMore}
                                    >
                                        {loadingMore ? 'Loading...' : 'Load more'}
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
