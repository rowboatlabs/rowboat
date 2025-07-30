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
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { useRouter } from 'next/navigation';

// Add glow animation styles
const glowStyles = `
    @keyframes glow {
        0% {
            border-color: rgba(99, 102, 241, 0.3);
            box-shadow: 0 0 8px 1px rgba(99, 102, 241, 0.2);
        }
        50% {
            border-color: rgba(99, 102, 241, 0.6);
            box-shadow: 0 0 12px 2px rgba(99, 102, 241, 0.4);
        }
        100% {
            border-color: rgba(99, 102, 241, 0.3);
            box-shadow: 0 0 8px 1px rgba(99, 102, 241, 0.2);
        }
    }

    @keyframes glow-dark {
        0% {
            border-color: rgba(129, 140, 248, 0.3);
            box-shadow: 0 0 8px 1px rgba(129, 140, 248, 0.2);
        }
        50% {
            border-color: rgba(129, 140, 248, 0.6);
            box-shadow: 0 0 12px 2px rgba(129, 140, 248, 0.4);
        }
        100% {
            border-color: rgba(129, 140, 248, 0.3);
            box-shadow: 0 0 8px 1px rgba(129, 140, 248, 0.2);
        }
    }

    .animate-glow {
        animation: glow 2s ease-in-out infinite;
        border-width: 2px;
    }

    .dark .animate-glow {
        animation: glow-dark 2s ease-in-out infinite;
        border-width: 2px;
    }
`;

// Textarea styling from CreateProject component
const textareaStyles = clsx(
    "w-full",
    "rounded-lg p-3",
    "border border-gray-200 dark:border-gray-700",
    "bg-white dark:bg-gray-800",
    "hover:bg-gray-50 dark:hover:bg-gray-750",
    "focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20",
    "placeholder:text-gray-400 dark:placeholder:text-gray-500",
    "transition-all duration-200"
);

const emptyTextareaStyles = clsx(
    "animate-glow",
    "border-indigo-500/40 dark:border-indigo-400/40",
    "shadow-[0_0_8px_1px_rgba(99,102,241,0.2)] dark:shadow-[0_0_8px_1px_rgba(129,140,248,0.2)]"
);

export default function App() {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProjectPaneOpen, setIsProjectPaneOpen] = useState(false);
    const [defaultName, setDefaultName] = useState('Assistant 1');
    const [userPrompt, setUserPrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [promptError, setPromptError] = useState<string | null>(null);
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

    // Inject glow animation styles
    useEffect(() => {
        const styleSheet = document.createElement("style");
        styleSheet.innerText = glowStyles;
        document.head.appendChild(styleSheet);

        return () => {
            document.head.removeChild(styleSheet);
        };
    }, []);

    const handleCreateAssistant = async () => {
        try {
            if (!userPrompt.trim()) {
                setPromptError("Prompt cannot be empty");
                return;
            }
            
            setIsCreating(true);
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
                        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 leading-tight">
                            Build <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Rowboats</span> that work for you
                        </h1>
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
                                    <div className="relative group flex flex-col">
                                        <div className="relative">
                                            <Textarea
                                                value={userPrompt}
                                                onChange={(e) => {
                                                    setUserPrompt(e.target.value);
                                                    setPromptError(null);
                                                }}
                                                placeholder="Ask Rowboat to build an AI SDR agent..."
                                                className={clsx(
                                                    textareaStyles,
                                                    "text-base",
                                                    "text-gray-900 dark:text-gray-100",
                                                    promptError && "border-red-500 focus:ring-red-500/20",
                                                    !userPrompt && emptyTextareaStyles,
                                                    "pr-14" // more space for send button
                                                )}
                                                style={{ minHeight: "120px" }}
                                                autoFocus
                                                autoResize
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleCreateAssistant();
                                                    }
                                                }}
                                            />
                                            <div className="absolute right-3 bottom-3 z-10">
                                                <button
                                                    type="submit"
                                                    disabled={isCreating || !userPrompt.trim()}
                                                    onClick={handleCreateAssistant}
                                                    className={clsx(
                                                        "rounded-full p-2",
                                                        userPrompt.trim()
                                                            ? "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:hover:bg-indigo-800/60 dark:text-indigo-300"
                                                            : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
                                                        "transition-all duration-200 scale-100 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-95 hover:shadow-md dark:hover:shadow-indigo-950/10"
                                                    )}
                                                >
                                                    <Send size={18} />
                                                </button>
                                            </div>
                                        </div>
                                        {promptError && (
                                            <p className="text-sm text-red-500 m-0 mt-2">
                                                {promptError}
                                            </p>
                                        )}
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