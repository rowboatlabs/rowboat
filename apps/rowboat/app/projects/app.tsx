'use client';

import { Project } from "../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects } from "../actions/project_actions";
import { USE_MULTIPLE_PROJECTS } from "@/app/lib/feature_flags";
import { SearchProjects } from "./components/search-projects";
import { CreateProject } from "./components/create-project";
import clsx from 'clsx';

export default function App() {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProjectPaneOpen, setIsProjectPaneOpen] = useState(false);
    const [defaultName, setDefaultName] = useState('Assistant 1');

    const getNextAssistantNumber = (projects: z.infer<typeof Project>[]) => {
        const untitledProjects = projects
            .map(p => p.name)
            .filter(name => name.startsWith('Assistant '))
            .map(name => {
                const num = parseInt(name.replace('Assistant ', ''));
                return isNaN(num) ? 0 : num;
            });

        if (untitledProjects.length === 0) return 1;
        return Math.max(...untitledProjects) + 1;
    };

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
                const nextNumber = getNextAssistantNumber(sortedProjects);
                const newDefaultName = `Assistant ${nextNumber}`;
                setDefaultName(newDefaultName);
                // Default open project pane if there is at least one project
                if (sortedProjects.length > 0) {
                    setIsProjectPaneOpen(true);
                }
            }
        }

        fetchProjects();

        return () => {
            ignore = true;
        }
    }, []);

    return (
        <div className="px-16 pt-8 space-y-8">
            {/* Create New Assistant Section */}
            <div className="w-full">
                <CreateProject
                    defaultName={defaultName}
                    onOpenProjectPane={() => setIsProjectPaneOpen(false)}
                    isProjectPaneOpen={false}
                    hideHeader={false}
                />
            </div>

            {/* Select Existing Assistant Section */}
            {USE_MULTIPLE_PROJECTS && projects.length > 0 && (
                <div className="w-full">
                    <div className="card">
                        <div className="px-4 pt-4 pb-6">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                                Select existing assistant
                            </h2>
                        </div>
                        <div className="px-4 pb-4 max-h-96 overflow-y-auto">
                            {isLoading ? (
                                <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
                                    Loading assistants...
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                    {projects.map((project) => (
                                        <a
                                            key={project._id}
                                            href={`/projects/${project._id}/workflow`}
                                            className="block p-4 border border-zinc-200 dark:border-zinc-700 rounded-lg hover:border-indigo-300 dark:hover:border-indigo-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-all group"
                                        >
                                            <div className="space-y-2">
                                                <div className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-1">
                                                    {project.name}
                                                </div>
                                                <div className="text-xs text-zinc-500 dark:text-zinc-500">
                                                    Created {new Date(project.createdAt).toLocaleDateString()}
                                                </div>
                                                <div className="flex items-center justify-between">
                                                    <div className="text-xs text-zinc-400 dark:text-zinc-600">
                                                        Last updated {new Date(project.lastUpdatedAt).toLocaleDateString()}
                                                    </div>
                                                    <div className="w-2 h-2 rounded-full bg-green-500 opacity-75"></div>
                                                </div>
                                            </div>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
} 