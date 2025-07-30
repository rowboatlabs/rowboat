'use client';

import { Project } from "../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects, createProject } from "../actions/project_actions";
import { USE_MULTIPLE_PROJECTS } from "@/app/lib/feature_flags";
import { SearchProjects } from "./components/search-projects";
import { CreateProject } from "./components/create-project";
import clsx from 'clsx';
import Image from 'next/image';
import { Button } from "@/components/ui/button";
import { useRouter } from 'next/navigation';

export default function App() {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProjectPaneOpen, setIsProjectPaneOpen] = useState(false);
    const [defaultName, setDefaultName] = useState('Assistant 1');
    const [userPrompt, setUserPrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const router = useRouter();

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

    const handleCreateAssistant = async () => {
        if (!userPrompt.trim()) return;
        
        setIsCreating(true);
        try {
            const formData = new FormData();
            formData.append('name', defaultName);
            
            const response = await createProject(formData);
            if ('id' in response) {
                // Store the prompt in localStorage for the workflow page
                localStorage.setItem(`project_prompt_${response.id}`, userPrompt);
                router.push(`/projects/${response.id}/workflow`);
            }
        } catch (error) {
            console.error('Error creating project:', error);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Hero Section */}
            <div className="px-8 py-16">
                <div className="max-w-6xl mx-auto">
                    {/* Main Headline */}
                    <div className="text-center mb-16">
                        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 dark:text-gray-100 mb-6 leading-tight">
                            Let AI build and manage your{' '}
                            <span className="text-blue-500">agent workforce</span>
                        </h1>
                        
                        {/* Y Combinator Badge */}
                        <div className="inline-flex items-center gap-2 bg-white dark:bg-gray-800 px-4 py-2 rounded-full shadow-sm border border-gray-200 dark:border-gray-700">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Backed by</span>
                            <div className="flex items-center gap-1">
                                <div className="w-5 h-5 bg-orange-500 text-white text-xs font-bold flex items-center justify-center rounded">
                                    Y
                                </div>
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Combinator</span>
                            </div>
                        </div>
                    </div>

                    {/* Input Section with Mascot */}
                    <div className="max-w-4xl mx-auto">
                        <div className="flex items-start gap-12">
                            {/* Mascot */}
                            <div className="flex-shrink-0">
                                <Image
                                    src="/mascot.png"
                                    alt="Rowboat Mascot"
                                    width={200}
                                    height={200}
                                    className="w-[200px] h-[200px] object-contain"
                                />
                            </div>
                            
                            {/* Input Area */}
                            <div className="flex-1">
                                <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                                        Hey! What agents can I build for you?
                                    </h2>
                                    <textarea
                                        value={userPrompt}
                                        onChange={(e) => setUserPrompt(e.target.value)}
                                        placeholder="Ask Rowboat to build an AI SDR agent..."
                                        className="w-full p-4 text-base border border-gray-300 dark:border-gray-600 rounded-lg resize-none bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[120px]"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleCreateAssistant();
                                            }
                                        }}
                                    />
                                    <div className="flex justify-end mt-4">
                                        <Button
                                            onClick={handleCreateAssistant}
                                            disabled={!userPrompt.trim() || isCreating}
                                            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isCreating ? 'Getting Started...' : 'Get Started'}
                                            {!isCreating && (
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                                </svg>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Select Existing Assistant Section */}
            {USE_MULTIPLE_PROJECTS && projects.length > 0 && (
                <div className="px-8 pb-16">
                    <div className="max-w-6xl mx-auto">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
                            <div className="px-6 pt-6 pb-4">
                                <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                                    Select existing assistant
                                </h2>
                            </div>
                            <div className="px-6 pb-6 max-h-96 overflow-y-auto">
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400">
                                        Loading assistants...
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                        {projects.map((project) => (
                                            <a
                                                key={project._id}
                                                href={`/projects/${project._id}/workflow`}
                                                className="block p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all group hover:shadow-md"
                                            >
                                                <div className="space-y-2">
                                                    <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                                                        {project.name}
                                                    </div>
                                                    <div className="text-xs text-gray-500 dark:text-gray-400">
                                                        Created {new Date(project.createdAt).toLocaleDateString()}
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-xs text-gray-400 dark:text-gray-500">
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
                </div>
            )}
        </div>
    );
} 