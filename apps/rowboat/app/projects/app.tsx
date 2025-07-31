'use client';

import { Project } from "../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects } from "../actions/project_actions";
import { BuildAssistantSection } from "./components/build-assistant-section";
import { MyAssistantsSection } from "./components/my-assistants-section";
import { TemplatesSection } from "./components/templates-section";
import { useRouter, useSearchParams } from 'next/navigation';


export default function App() {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProjectPaneOpen, setIsProjectPaneOpen] = useState(false);
    const [defaultName, setDefaultName] = useState('Assistant 1');
    const router = useRouter();
    const searchParams = useSearchParams();
    const section = searchParams.get('section') || 'build';


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
        <div className="min-h-screen bg-white dark:bg-gray-900">
            {section === 'my-assistants' && <MyAssistantsSection />}
            {section === 'templates' && <TemplatesSection />}
            {section === 'build' && <BuildAssistantSection defaultName={defaultName} />}
            {!section && <BuildAssistantSection defaultName={defaultName} />}
        </div>
    );
}