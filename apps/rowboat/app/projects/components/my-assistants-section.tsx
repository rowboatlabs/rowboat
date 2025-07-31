'use client';

import { useState, useEffect } from "react";
import { z } from "zod";
import { listProjects } from "@/app/actions/project_actions";
import { Project } from "@/app/lib/types/project_types";

interface MyAssistantsSectionProps {}

export function MyAssistantsSection({}: MyAssistantsSectionProps) {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
        <div className="px-8 py-16">
            <div className="max-w-7xl mx-auto">
                <div className="px-6 pt-6 pb-4">
                    <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                        My assistants
                    </h2>
                </div>
                <div className="px-6 pb-6 max-h-96 overflow-y-auto">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400">
                                Loading assistants...
                            </div>
                        ) : projects.length === 0 ? (
                            <div className="flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400">
                                No assistants found. Create your first assistant to get started!
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {projects.map((project) => (
                                    <a
                                        key={project._id}
                                        href={`/projects/${project._id}/workflow`}
                                        className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all group hover:shadow-sm"
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
                                    </a>
                                ))}
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}