import { DataSource } from "@/src/entities/models/data-source";
import { Spinner } from "@heroui/react";
import { z } from 'zod';
import { CheckCircleIcon, XCircleIcon, ClockIcon } from "lucide-react";

export function SourceStatus({
    status,
    compact = false,
}: {
    status: z.infer<typeof DataSource>['status'],
    compact?: boolean;
}) {
    return (
        <div className="flex items-center gap-2">
            {status === 'ready' && (
                <>
                    <CheckCircleIcon className="w-4 h-4 text-green-500 dark:text-green-400" />
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Ready</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            This source has been indexed and is ready to use.
                        </span>
                    </div>
                </>
            )}
            
            {status === 'pending' && (
                <>
                    <div className="shrink-0">
                        <Spinner size="sm" className="text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Processing</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            This source is being processed. This may take a few minutes.
                        </span>
                    </div>
                </>
            )}
            
            {status === 'error' && (
                <>
                    <XCircleIcon className="w-4 h-4 text-red-500 dark:text-red-400" />
                    <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Error</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                            There was an error processing this source.
                        </span>
                    </div>
                </>
            )}
        </div>
    );
}