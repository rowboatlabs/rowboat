'use client';

import { Project } from "../../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects } from "../../actions/project_actions";
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
            }
        }

        fetchProjects();

        return () => {
            ignore = true;
        }
    }, []);

    return (
        <div className="flex gap-8 px-16 pt-8">
            {USE_MULTIPLE_PROJECTS && isProjectPaneOpen && (
                <div className="w-1/3 min-w-[300px] max-w-[400px]">
                    <SearchProjects
                        projects={projects}
                        isLoading={isLoading}
                        heading="Select existing assistant"
                        className="h-full"
                        onClose={() => setIsProjectPaneOpen(false)}
                    />
                </div>
            )}

            <div className={clsx(
                "flex-1",
                !isProjectPaneOpen && "w-full",
            )}>
                <CreateProject
                    defaultName={defaultName}
                    onOpenProjectPane={() => setIsProjectPaneOpen(true)}
                    isProjectPaneOpen={isProjectPaneOpen}
                />
            </div>
        </div>
    );
} 