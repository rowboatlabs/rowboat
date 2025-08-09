'use client';

import { useState, useRef, useEffect } from "react";
import { createProject, createProjectFromWorkflowJson, listTemplates, listProjects } from "@/app/actions/project_actions";
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import Image from 'next/image';
import mascotImage from '/public/mascot.png';
import { Button } from "@/components/ui/button";
import { Upload, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { TextareaWithSend } from "@/app/components/ui/textarea-with-send";
import { Workflow } from '../../lib/types/workflow_types';
import { PictureImg } from '@/components/ui/picture-img';
import { Tabs, Tab } from "@/components/ui/tabs";
import { Project } from "@/app/lib/types/project_types";
import { z } from "zod";
import Link from 'next/link';



interface BuildAssistantSectionProps {
    defaultName: string;
}

const ITEMS_PER_PAGE = 6;

export function BuildAssistantSection({ defaultName }: BuildAssistantSectionProps) {
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
    const handleTemplateSelect = async (templateId: string, templateName: string) => {
        try {
            const formData = new FormData();
            formData.append('name', templateName);
            formData.append('template', templateId);
            const response = await createProject(formData);
            if ('id' in response) {
                router.push(`/projects/${response.id}/workflow`);
            }
        } catch (error) {
            console.error('Error creating project from template:', error);
        }
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
            const formData = new FormData();
            formData.append('name', defaultName);
            formData.append('workflowJson', text);
            const response = await createProjectFromWorkflowJson(formData);
            if ('id' in response) {
                router.push(`/projects/${response.id}/workflow`);
            } else {
                setImportError(response.billingError || 'Failed to create project');
            }
        } catch (err) {
            setImportError('Invalid JSON: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setImportLoading(false);
        }
    };

    // Handle "I'll build it myself" button
    const handleBuildItMyself = async () => {
        try {
            const formData = new FormData();
            formData.append('name', defaultName);
            formData.append('template', 'default');
            const response = await createProject(formData);
            if ('id' in response) {
                router.push(`/projects/${response.id}/workflow`);
            }
        } catch (error) {
            console.error('Error creating project:', error);
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
                                                        isSubmitting={isCreating}
                                                        placeholder="Example: build me an AI SDR agent..."
                                                        className={clsx(
                                                            "w-full rounded-lg p-3 border border-gray-200 dark:border-gray-700",
                                                            "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750",
                                                            "focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20",
                                                            "placeholder:text-gray-400 dark:placeholder:text-gray-500 transition-all duration-200",
                                                            "text-base text-gray-900 dark:text-gray-100 min-h-32",
                                                            promptError && "border-red-500 focus:ring-red-500/20",
                                                            !userPrompt && "animate-pulse border-2 border-indigo-500/40 dark:border-indigo-400/40 shadow-lg shadow-indigo-500/20 dark:shadow-indigo-400/20"
                                                        )}
                                                        rows={3}
                                                        autoFocus
                                                        autoResize
                                                    />
                                                    {promptError && (
                                                        <p className="text-sm text-red-500 m-0 mt-2">
                                                            {promptError}
                                                        </p>
                                                    )}
                                                </div>

                                                {/* Separation line with OR */}
                                                <div className="relative my-3">
                                                    <div className="absolute inset-0 flex items-center">
                                                        <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                                                    </div>
                                                    <div className="relative flex justify-center text-sm">
                                                        <span className="bg-white dark:bg-gray-800 px-3 text-gray-500 dark:text-gray-400">OR</span>
                                                    </div>
                                                </div>

                                                {/* Action buttons */}
                                                <div className="flex gap-3 justify-start">
                                                    <Button
                                                        variant="primary"
                                                        size="sm"
                                                        onClick={handleImportJsonClick}
                                                        type="button"
                                                        startContent={<Upload size={14} />}
                                                        className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600"
                                                        disabled={importLoading}
                                                    >
                                                        {importLoading ? 'Importing...' : 'Import JSON'}
                                                    </Button>
                                                    <Button
                                                        variant="primary"
                                                        size="sm"
                                                        onClick={handleBuildItMyself}
                                                        type="button"
                                                        className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600"
                                                    >
                                                        Go to Builder
                                                    </Button>
                                                </div>

                                                {importError && (
                                                    <p className="text-sm text-red-500 mt-2">
                                                        {importError}
                                                    </p>
                                                )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Tab>
                                <Tab key="existing" title="My Assistants">
                                    <div className="pt-4">
                                        <div className="h-96 flex flex-col bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
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
                                                    <div className="flex-1 overflow-y-auto">
                                                        <div className="space-y-2">
                                                            {currentProjects.map((project) => (
                                                                <Link
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
                    {selectedTab === 'new' && (
                        <div className="max-w-5xl mx-auto mt-16">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                            <div className="text-left mb-6">
                                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                                    Pre-built Assistants
                                </h2>
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
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {templates.map((template) => (
                                        <button
                                            key={template.id}
                                            onClick={() => handleTemplateSelect(template.id, template.name)}
                                            className="block p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all group hover:shadow-md text-left"
                                        >
                                            <div className="space-y-2">
                                                <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                                                    {template.name}
                                                </div>
                                                <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                                                    {template.description}
                                                </div>

                                                {/* Tool logos */}
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
                                                    <div className="text-xs text-gray-400 dark:text-gray-500">
                                                    </div>
                                                    <div className="w-2 h-2 rounded-full bg-blue-500 opacity-75"></div>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </>
    );
}