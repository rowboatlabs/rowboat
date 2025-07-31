'use client';

import { useState, useEffect } from "react";
import { z } from "zod";
import { listProjects } from "@/app/actions/project_actions";
import { Project } from "@/app/lib/types/project_types";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import clsx from 'clsx';
import Link from 'next/link';

interface MyAssistantsSectionProps {}

const ITEMS_PER_PAGE = 6;

export function MyAssistantsSection({}: MyAssistantsSectionProps) {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);

    const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentProjects = projects.slice(startIndex, endIndex);

    useEffect(() => {
        let ignore = false;

        async function fetchProjects() {
            setIsLoading(true);
            const projects = await listProjects();
            if (!ignore) {
                const sortedProjects = [...projects].sort((a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                setProjects(sortedProjects);
                setIsLoading(false);
            }
        }

        fetchProjects();

        return () => {
            ignore = true;
        }
    }, []);

    return (
        <div className="h-screen flex flex-col px-8 py-8 overflow-hidden">
            <div className="max-w-7xl mx-auto w-full flex flex-col h-full">
                <div className="px-6 pb-4">
                    <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                        My assistants
                    </h2>
                </div>
                
                {/* Add boundary around the assistants section */}
                <div className="mx-6 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 flex-1 flex flex-col">
                    <div className="flex flex-col h-full">
                        {/* Assistant list that shows exactly 6 items */}
                        <div className="flex-1 p-6 overflow-hidden">
                            {isLoading ? (
                                <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
                                    Loading assistants...
                                </div>
                            ) : projects.length === 0 ? (
                                <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
                                    No assistants found. Create your first assistant to get started!
                                </div>
                            ) : (
                                <div className="space-y-2 h-full flex flex-col justify-start">
                                    {currentProjects.map((project) => (
                                        <Link
                                            key={project._id}
                                            href={`/projects/${project._id}/workflow`}
                                            className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all group hover:shadow-sm flex-shrink-0 h-[calc((100%-2.5rem)/6)]"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2 h-2 rounded-full bg-green-500 opacity-75 flex-shrink-0"></div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                                                            {project.name}
                                                        </div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                            Created {new Date(project.createdAt).toLocaleDateString()} • Last updated {new Date(project.lastUpdatedAt).toLocaleDateString()}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex-shrink-0 ml-4">
                                                <div className="text-xs text-gray-400 dark:text-gray-500">
                                                    →
                                                </div>
                                            </div>
                                        </Link>
                                    ))}
                                    {/* Fill remaining slots if fewer than 6 items */}
                                    {currentProjects.length < 6 && Array.from({ length: 6 - currentProjects.length }).map((_, index) => (
                                        <div 
                                            key={`empty-${index}`}
                                            className="flex-shrink-0 h-[calc((100%-2.5rem)/6)]"
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Pagination controls */}
                        {!isLoading && projects.length > 0 && totalPages > 1 && (
                            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className={clsx(
                                        "p-2 rounded-md transition-colors",
                                        "text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400",
                                        "disabled:opacity-50 disabled:cursor-not-allowed",
                                        "hover:bg-gray-100 dark:hover:bg-gray-700"
                                    )}
                                >
                                    <ChevronLeftIcon className="w-5 h-5" />
                                </button>
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Page {currentPage} of {totalPages} ({projects.length} assistants)
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                    className={clsx(
                                        "p-2 rounded-md transition-colors",
                                        "text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400",
                                        "disabled:opacity-50 disabled:cursor-not-allowed",
                                        "hover:bg-gray-100 dark:hover:bg-gray-700"
                                    )}
                                >
                                    <ChevronRightIcon className="w-5 h-5" />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}