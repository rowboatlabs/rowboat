import Link from "next/link";
import { Turn } from "@/src/entities/models/turn";
import { z } from "zod";

export function ReasonBadge({ 
    reason, 
    projectId 
}: { 
    reason: z.infer<typeof Turn>['reason']; 
    projectId?: string;
}) {
    const getReasonDisplay = () => {
        switch (reason.type) {
            case 'chat':
                return { label: 'CHAT', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' };
            case 'api':
                return { label: 'API', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' };
            case 'job':
                return { 
                    label: `JOB: ${reason.jobId}`, 
                    color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
                    isJob: true,
                    jobId: reason.jobId
                };
            default:
                return { label: 'UNKNOWN', color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300' };
        }
    };

    const { label, color, isJob, jobId } = getReasonDisplay();

    // Job reasons should ALWAYS be linked when we have a projectId
    if (isJob && jobId && projectId) {
        return (
            <Link
                href={`/projects/${projectId}/jobs/${jobId}`}
                className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-mono font-medium ${color} hover:opacity-80 transition-opacity`}
            >
                {label}
            </Link>
        );
    }

    // Otherwise render as a regular badge
    return (
        <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-mono font-medium ${color}`}>
            {label}
        </span>
    );
}
