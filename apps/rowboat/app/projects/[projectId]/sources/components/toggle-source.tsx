'use client';
import { toggleDataSource } from "../../../../actions/data-source.actions";
import { Spinner } from "@heroui/react";
import { useState } from "react";

export function ToggleSource({
    sourceId,
    active,
    compact = false,
    className
}: {
    sourceId: string;
    active: boolean;
    compact?: boolean;
    className?: string;
}) {
    const [loading, setLoading] = useState(false);
    const [isActive, setIsActive] = useState(active);

    async function handleToggle() {
        setLoading(true);
        try {
            await toggleDataSource(sourceId, !isActive);
            setIsActive(!isActive);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="flex flex-col gap-1.5 items-start">
            <div className="flex items-center gap-2">
                <button
                    onClick={handleToggle}
                    disabled={loading}
                    className={`
                        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
                        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500/20 
                        ${isActive ? 'bg-indigo-500' : 'bg-gray-200 dark:bg-gray-700'}
                        disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                    role="switch"
                    aria-checked={isActive}
                >
                    <span
                        className={`
                            pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 
                            transition duration-200 ease-in-out
                            ${isActive ? 'translate-x-4' : 'translate-x-0'}
                        `}
                    />
                </button>
                <span className="text-sm text-gray-700 dark:text-gray-300">
                    {isActive ? "Active" : "Inactive"}
                </span>
                {loading && <Spinner size="sm" className="text-gray-400" />}
            </div>
            {!compact && !isActive && (
                <p className="text-xs text-red-600 dark:text-red-400">
                    This data source will not be used for RAG.
                </p>
            )}
        </div>
    );
}