'use client';

import { useState, useRef, useEffect } from "react";
import { listTemplates, listProjects } from "@/app/actions/project.actions";
import { createProjectWithOptions, createProjectFromJsonWithOptions, createProjectFromTemplate } from "../lib/project-creation-utils";
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import Image from 'next/image';
import mascotImage from '@/public/mascot.png';
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { TextareaWithSend } from "@/app/components/ui/textarea-with-send";
import { Workflow } from '../../lib/types/workflow_types';
import { PictureImg } from '@/components/ui/picture-img';
import { Tabs, Tab } from "@/components/ui/tabs";
import { Project } from "@/src/entities/models/project";
import { z } from "zod";
import Link from 'next/link';

const SHOW_PREBUILT_CARDS = process.env.NEXT_PUBLIC_SHOW_PREBUILT_CARDS !== 'false';



const ITEMS_PER_PAGE = 10;

const copilotPrompts = {
    "Blog assistant": {
        prompt: "Build an assistant to help with writing a blog post and updating it on google docs",
        emoji: "📝"
    },
    "Meeting prep workflow": {
        prompt: "Build a meeting prep pipeline which takes a google calendar invite as input and performs research on the guests using Duckduckgo search and send an email to me",
        emoji: "📅"
    },
    "Scheduling assistant": {
        prompt: "Build a scheduling assistant that helps users manage their calendar, book meetings, find available time slots, send reminders, and optimize their daily schedule based on priorities and preferences",
        emoji: "✅"
    },
    "Reddit & HN assistant": {
        prompt: "Build an assistant that helps me with browsing Reddit and Hacker News",
        emoji: "🔍"
    }
};

export function BuildAssistantSection() {
    const [userPrompt, setUserPrompt] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [promptError, setPromptError] = useState<string | null>(null);
    const [importLoading, setImportLoading] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [templates, setTemplates] = useState<any[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [templatesError, setTemplatesError] = useState<string | null>(null);
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedTab, setSelectedTab] = useState('new');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const searchParams = useSearchParams();
    const [autoCreateLoading, setAutoCreateLoading] = useState(false);
    const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);

    const totalPages = Math.ceil(projects.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentProjects = projects.slice(startIndex, endIndex);

    // Extract unique tools from template - using same approach as ToolkitCard
    const getUniqueTools = (template: any) => {
        if (!template.tools) return [];

        const uniqueToolsMap = new Map();
        template.tools.forEach((tool: any) => {
            if (!uniqueToolsMap.has(tool.name)) {
                // Include all tools, following the same pattern as Composio toolkit cards
                const toolData = {
                    name: tool.name,
                    isComposio: tool.isComposio,
                    isLibrary: tool.isLibrary,
                    logo: tool.isComposio && tool.composioData?.logo ? tool.composioData.logo : null,
                };

                uniqueToolsMap.set(tool.name, toolData);
            }
        });

        return Array.from(uniqueToolsMap.values()).filter(tool => tool.logo); // Only show tools with logos like ToolkitCard
    };

    const fetchTemplates = async () => {
        setTemplatesLoading(true);
        setTemplatesError(null);
        try {
            const templatesArray = await listTemplates();
            setTemplates(templatesArray);
        } catch (error) {
            console.error('Error fetching templates:', error);
            setTemplatesError(error instanceof Error ? error.message : 'Failed to load templates');
        } finally {
            setTemplatesLoading(false);
        }
    };

    // Handle template selection
    const handleTemplateSelect = async (template: any) => {
        // Show a small non-blocking spinner on the clicked card
        setLoadingTemplateId(template.id);
        try {
            await createProjectWithOptions({
                template: template.id,
                // Prefer a card-specific copilot prompt if present on the template JSON
                prompt: template.copilotPrompt || 'Explain this workflow',
                router,
                onError: () => {
                    // Clear loading state if creation fails
                    setLoadingTemplateId(null);
                },
            });
        } catch (_err) {
            // In case of unexpected error, clear loading state
            setLoadingTemplateId(null);
        }
    };

    // Handle prompt card selection
    const handlePromptSelect = (promptText: string) => {
        setUserPrompt(promptText);
        setPromptError(null);
    };

    const fetchProjects = async () => {
        setProjectsLoading(true);
        try {
            const projectsList = await listProjects();
            const sortedProjects = [...projectsList].sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            setProjects(sortedProjects);
        } catch (error) {
            console.error('Error fetching projects:', error);
        } finally {
            setProjectsLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
        fetchProjects();
    }, []);

    // Handle URL parameters for auto-creation and direct redirect to build view
    useEffect(() => {
        const urlPrompt = searchParams.get('prompt');
        const urlTemplate = searchParams.get('template');
        const sharedId = searchParams.get('shared');
        const importUrl = searchParams.get('importUrl');

        const run = async () => {
            if (sharedId || importUrl) {
                try {
                    setAutoCreateLoading(true);
                    const qs = sharedId ? `id=${encodeURIComponent(sharedId)}` : `url=${encodeURIComponent(importUrl!)}`;
                    const resp = await fetch(`/api/shared-workflow?${qs}`, { cache: 'no-store' });
                    if (!resp.ok) {
                        const data = await resp.json().catch(() => ({}));
                        throw new Error(data.error || `Failed to load shared workflow (${resp.status})`);
                    }
                    const workflowObj = await resp.json();
                    await createProjectFromJsonWithOptions({
                        workflowJson: JSON.stringify(workflowObj),
                        router,
                        onError: (error) => {
                            console.error('Error creating project from shared workflow:', error);
                            setAutoCreateLoading(false);
                        }
                    });
                    return;
                } catch (err) {
                    console.error('Error auto-importing shared workflow:', err);
                    setAutoCreateLoading(false);
                }
            }

            if (urlPrompt || urlTemplate) {
                setAutoCreateLoading(true);
                createProjectWithOptions({
                    template: urlTemplate || undefined,
                    prompt: urlPrompt || undefined,
                    router,
                    onError: (error) => {
                        console.error('Error auto-creating project:', error);
                        setAutoCreateLoading(false);
                        // Fall back to showing the form with the prompt pre-filled
                        if (urlPrompt) {
                            setUserPrompt(urlPrompt);
                        }
                    }
                });
            }
        };

        run();
    }, [searchParams, router]);

    const handleCreateAssistant = async () => {
        setIsCreating(true);
        try {
            await createProjectWithOptions({
                prompt: userPrompt.trim(),
                router,
                onError: (error) => {
                    console.error('Error creating project:', error);
                }
            });
        } catch (error) {
            console.error('Error creating project:', error);
            setIsCreating(false);
        }
    };

    // Import JSON functionality
    const handleImportJsonClick = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
            setTimeout(() => {
                fileInputRef.current?.click();
            }, 0);
        }
    };

    // Handle file selection
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }
        setImportLoading(true);
        setImportError(null);
        try {
            const text = await file.text();
            let parsed = Workflow.safeParse(JSON.parse(text));
            if (!parsed.success) {
                setImportError('Invalid workflow JSON: ' + JSON.stringify(parsed.error.issues));
                setImportLoading(false);
                return;
            }

            // Create project from imported JSON
            await createProjectFromJsonWithOptions({
                workflowJson: text,
                router,
                onError: (error) => {
                    setImportError(error instanceof Error ? error.message : String(error));
                }
            });
        } catch (err) {
            setImportError('Invalid JSON: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setImportLoading(false);
        }
    };

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleFileChange}
            />
            {autoCreateLoading && (
                <div className="flex flex-col items-center justify-center min-h-screen">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">
                        Creating your assistant...
                    </p>
                </div>
            )}
            {!autoCreateLoading && (
            <div className="px-8 py-16">
                <div className="max-w-7xl mx-auto">
                    {/* Main Headline */}
                    <div className="text-center mb-16">
                        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-gray-100 mb-6 leading-tight">
                            Build <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Rowboats</span> that Work for You
                        </h1>
                    </div>

                    {/* Tabs Section */}
                    <div className="max-w-5xl mx-auto">
                        <div className="p-6 pb-0">
                            <Tabs defaultSelectedKey="new" selectedKey={selectedTab} onSelectionChange={(key) => setSelectedTab(key as string)} className="w-full">
                                <Tab key="new" title="New Assistant">
                                    <div className="pt-4">
                                        <div className="flex items-center gap-12">
                                            {/* Mascot */}
                                            <div className="flex-shrink-0">
                                                <Image
                                                    src={mascotImage}
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
                                                    <TextareaWithSend
                                                        value={userPrompt}
                                                        onChange={(value) => {
                                                            setUserPrompt(value);
                                                            setPromptError(null);
                                                        }}
                                                        onSubmit={handleCreateAssistant}
                                                        onImportJson={handleImportJsonClick}
                                                        isImporting={importLoading}
                                                        importDisabled={importLoading}
                                                        isSubmitting={isCreating}
                                                        placeholder="Example: Build me an assistant to manage my email and calendar..."
                                                        className={clsx(
                                                            "w-full rounded-lg p-3 border border-gray-200 dark:border-gray-700",
                                                            "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750",
                                                            "focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20",
                                                            "placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all duration-200",
                                                            "text-base text-gray-900 dark:text-gray-100 min-h-32",
                                                            promptError && "border-red-500 focus:ring-red-500/20",
                                                            !userPrompt && "animate-pulse border-2 border-indigo-500/40 dark:border-indigo-400/40 shadow-lg shadow-indigo-500/20 dark:shadow-indigo-400/20"
                                                        )}
                                                        rows={4}
                                                        autoFocus
                                                        autoResize
                                                    />
                                                    {promptError && (
                                                        <p className="text-sm text-red-500 m-0 mt-2">
                                                            {promptError}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Removed separation line and secondary action per request */}

                                                {importError && (
                                                    <p className="text-sm text-red-500 mt-2">
                                                        {importError}
                                                    </p>
                                                )}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {/* Predefined Prompt Cards */}
                                        <div className="mt-8">
                                            <div className="flex flex-wrap gap-3 justify-center">
                                                {Object.entries(copilotPrompts).map(([name, config]) => (
                                                    <button
                                                        key={name}
                                                        onClick={() => handlePromptSelect(config.prompt)}
                                                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 hover:shadow-sm"
                                                    >
                                                        <span className="w-4 h-4 flex items-center justify-center">
                                                            {config.emoji}
                                                        </span>
                                                        {name}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </Tab>
                                <Tab key="existing" title="My Assistants">
                                    <div className="pt-4">
                                        <div className="flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
                                            {projectsLoading ? (
                                                <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
                                                    Loading assistants...
                                                </div>
                                            ) : projects.length === 0 ? (
                                                <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
                                                    No assistants found. Create your first assistant to get started!
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex-1">
                                                        <div className="space-y-2">
                                                            {currentProjects.map((project) => (
                                                                <Link
                                                                    key={project.id}
                                                                    href={`/projects/${project.id}/workflow`}
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
                                                                                    Created {new Date(project.createdAt).toLocaleDateString()}
                                                                                    {project.lastUpdatedAt && `• Last updated ${new Date(project.lastUpdatedAt).toLocaleDateString()}`}
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
                                                        </div>
                                                    </div>

                                                    {totalPages > 1 && (
                                                        <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
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
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </Tab>
                            </Tabs>
                        </div>
                    </div>

                    {/* Pre-built Assistants Section - Only show for New Assistant tab */}
                    {selectedTab === 'new' && SHOW_PREBUILT_CARDS && (
                        <div className="max-w-5xl mx-auto mt-16">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                            <div className="text-left mb-6">
                                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                                    Prebuilt Assistants
                                </h2>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Start quickly and let Skipper adapt it to your needs.
                                </p>
                            </div>
                            {templatesLoading ? (
                                <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
                                    Loading pre-built assistants...
                                </div>
                            ) : templatesError ? (
                                <div className="flex items-center justify-center py-12 text-sm text-red-500 dark:text-red-400">
                                    Error: {templatesError}
                                </div>
                            ) : templates.length === 0 ? (
                                <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">
                                    No pre-built assistants available
                                </div>
                            ) : (
                                (() => {
                                    const workTemplates = templates.filter((t) => (t.category || '').toLowerCase() === 'work productivity');
                                    const devTemplates = templates.filter((t) => (t.category || '').toLowerCase() === 'developer productivity');
                                    const newsTemplates = templates.filter((t) => (t.category || '').toLowerCase() === 'news & social');
                                    const customerSupportTemplates = templates.filter((t) => (t.category || '').toLowerCase() === 'customer support');

                                    const renderGrid = (items: any[]) => (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {items.map((template) => (
                                                <button
                                                    key={template.id}
                                                    onClick={() => handleTemplateSelect(template)}
                                                    disabled={loadingTemplateId === template.id}
                                                    className={clsx(
                                                        "relative block p-4 border border-gray-200 dark:border-gray-700 rounded-xl transition-all group text-left",
                                                        "hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:shadow-md",
                                                        loadingTemplateId === template.id && "opacity-90 cursor-not-allowed"
                                                    )}
                                                >
                                                    <div className="space-y-2">
                                                        <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                                                            {template.name}
                                                        </div>
                                                        <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                                                            {template.description}
                                                        </div>

                                                        {(() => {
                                                            const tools = getUniqueTools(template);
                                                            return tools.length > 0 && (
                                                                <div className="flex items-center gap-2 mt-2">
                                                                    <div className="text-xs text-gray-400 dark:text-gray-500">
                                                                        Tools:
                                                                    </div>
                                                                    <div className="flex items-center gap-1">
                                                                        {tools.slice(0, 4).map((tool) => (
                                                                            tool.logo && (
                                                                                <PictureImg
                                                                                    key={tool.name}
                                                                                    src={tool.logo}
                                                                                    alt={`${tool.name} logo`}
                                                                                    className="w-4 h-4 rounded-sm object-cover flex-shrink-0"
                                                                                    title={tool.name}
                                                                                />
                                                                            )
                                                                        ))}
                                                                        {tools.length > 4 && (
                                                                            <span className="text-xs text-gray-400 dark:text-gray-500">
                                                                                +{tools.length - 4}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}

                                                        <div className="flex items-center justify-between mt-2">
                                                            <div className="text-xs text-gray-400 dark:text-gray-500"></div>
                                                            {loadingTemplateId === template.id ? (
                                                                <div className="text-blue-600 dark:text-blue-400">
                                                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
                                                                </div>
                                                            ) : (
                                                                <div className="w-2 h-2 rounded-full bg-blue-500 opacity-75"></div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    );

                                    return (
                                        <div className="space-y-8">
                                            {workTemplates.length > 0 && (
                                                <div>
                                                    <div className="mb-3">
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/30">
                                                            Work Productivity
                                                        </span>
                                                    </div>
                                                    {renderGrid(workTemplates)}
                                                </div>
                                            )}
                                            {devTemplates.length > 0 && (
                                                <div>
                                                    <div className="mb-3">
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-300 dark:ring-indigo-400/30">
                                                            Developer Productivity
                                                        </span>
                                                    </div>
                                                    {renderGrid(devTemplates)}
                                                </div>
                                            )}
                                            {newsTemplates.length > 0 && (
                                                <div>
                                                    <div className="mb-3">
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 ring-1 ring-green-200 dark:bg-green-400/10 dark:text-green-300 dark:ring-green-400/30">
                                                            News & Social
                                                        </span>
                                                    </div>
                                                    {renderGrid(newsTemplates)} 
                                                </div>
                                            )}
                                            {customerSupportTemplates.length > 0 && (
                                                <div>
                                                    <div className="mb-3">
                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-400/10 dark:text-red-300 dark:ring-red-400/30">
                                                            Customer Support
                                                        </span>
                                                    </div>
                                                    {renderGrid(customerSupportTemplates)}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()
                            )}
                        </div>
                    </div>
                    )}
                </div>
            </div>
            )}
        </>
    );
}
