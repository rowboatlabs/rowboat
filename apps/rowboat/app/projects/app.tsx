'use client';

import { Project } from "../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects } from "../actions/project_actions";
import { BuildAssistantSection } from "./components/build-assistant-section";


export default function App() {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
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
            const projects = await listProjects();
            if (!ignore) {
                const sortedProjects = [...projects].sort((a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );

                setProjects(sortedProjects);
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
        <div className="min-h-screen bg-white dark:bg-gray-900">
            <BuildAssistantSection defaultName={defaultName} />
        </div>
    );
}