'use client';
import { Project } from "@/src/entities/models/project";
import { z } from "zod";
import { useState } from "react";
import clsx from 'clsx';
import { tokens } from "@/app/styles/design-tokens";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { RelativeTime } from "@primer/react";

interface ProjectListProps {
    projects: z.infer<typeof Project>[];
    isLoading: boolean;
    searchQuery: string;
}

const ITEMS_PER_PAGE = 10;

export function ProjectList({ projects, isLoading, searchQuery }: ProjectListProps) {
    const [currentPage, setCurrentPage] = useState(1);
    
    const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentProjects = projects.slice(startIndex, endIndex);

    if (isLoading) {
        return (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
                Loading projects...
            </div>
        );
    }

    if (projects.length === 0) {
        return (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
                {searchQuery
                    ? "No projects match your search"
                    : "You haven't created any projects yet"}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Scrollable project list */}
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                {currentProjects.map((project) => (
                    <Link
                        key={project._id}
                        href={`/projects/${project._id}`}
                        className={clsx(
                            "block px-4 py-3",
                            tokens.transitions.default,
                            tokens.colors.light.surfaceHover,
                            tokens.colors.dark.surfaceHover,
                            "group"
                        )}
                    >
                        <div className="flex justify-between items-start">
                            <div className="space-y-1">
                                <h3 className={clsx(
                                    tokens.typography.sizes.base,
                                    tokens.typography.weights.medium,
                                    tokens.colors.light.text.primary,
                                    tokens.colors.dark.text.primary,
                                    "group-hover:text-indigo-600 dark:group-hover:text-indigo-400",
                                    tokens.transitions.default
                                )}>
                                    {project.name}
                                </h3>
                                <p className={clsx(
                                    tokens.typography.sizes.xs,
                                    tokens.colors.light.text.muted,
                                    tokens.colors.dark.text.muted
                                )}>
                                    Created <RelativeTime date={new Date(project.createdAt)} />
                                </p>
                            </div>
                            <ChevronRightIcon className={clsx(
                                "w-5 h-5",
                                tokens.colors.light.text.muted,
                                tokens.colors.dark.text.muted,
                                "transform transition-transform group-hover:translate-x-0.5"
                            )} />
                        </div>
                    </Link>
                ))}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-800">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className={clsx(
                            "p-1 rounded-md",
                            "text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        <ChevronLeftIcon className="w-5 h-5" />
                    </button>
                    <span className={clsx(
                        tokens.typography.sizes.sm,
                        tokens.colors.light.text.secondary,
                        tokens.colors.dark.text.secondary
                    )}>
                        Page {currentPage} of {totalPages}
                    </span>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className={clsx(
                            "p-1 rounded-md",
                            "text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        <ChevronRightIcon className="w-5 h-5" />
                    </button>
                </div>
            )}
        </div>
    );
} 