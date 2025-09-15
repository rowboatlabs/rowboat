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
import { AssistantSection } from '@/components/common/AssistantSection';
import { UnifiedTemplatesSection } from '@/components/common/UnifiedTemplatesSection';

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
    const [communityTemplates, setCommunityTemplates] = useState<any[]>([]);
    const [communityTemplatesLoading, setCommunityTemplatesLoading] = useState(false);
    const [communityTemplatesError, setCommunityTemplatesError] = useState<string | null>(null);
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

    const fetchCommunityTemplates = async () => {
        setCommunityTemplatesLoading(true);
        setCommunityTemplatesError(null);
        try {
            const response = await fetch('/api/assistant-templates?source=community');
            if (!response.ok) throw new Error('Failed to fetch community templates');
            const data = await response.json();
            setCommunityTemplates(data.items || []);
        } catch (error) {
            console.error('Error fetching community templates:', error);
            setCommunityTemplatesError(error instanceof Error ? error.message : 'Failed to load community templates');
        } finally {
            setCommunityTemplatesLoading(false);
        }
    };

    // Handle template selection
    const handleTemplateSelect = async (template: any) => {
        // Show a small non-blocking spinner on the clicked card
        setLoadingTemplateId(template.id);
        try {
            if (template.type === 'prebuilt') {
                // Fetch full workflow from unified API, then create from JSON
                const res = await fetch(`/api/assistant-templates/${template.id}`);
                if (!res.ok) throw new Error('Failed to fetch template details');
                const data = await res.json();
                await createProjectFromJsonWithOptions({
                    workflowJson: JSON.stringify(data.workflow),
                    router,
                    onSuccess: (_projectId) => {},
                    onError: () => {
                        setLoadingTemplateId(null);
                    }
                });
            } else if (template.type === 'community') {
                // Handle community template import
                await createProjectFromJsonWithOptions({
                    workflowJson: JSON.stringify(template.workflow),
                    router,
                    onSuccess: (projectId) => {
                        router.push(`/projects/${projectId}/workflow`);
                    },
                    onError: (error) => {
                        console.error('Error creating project from community template:', error);
                        setLoadingTemplateId(null);
                    }
                });
            }
        } catch (_err) {
            // In case of unexpected error, clear loading state
            setLoadingTemplateId(null);
        }
    };

    // Stable guest id for like toggles
    const getGuestId = () => {
        try {
            let guestId = sessionStorage.getItem('guestId');
            if (!guestId) {
                guestId = `guest-${crypto.randomUUID()}`;
                sessionStorage.setItem('guestId', guestId);
            }
            return guestId;
        } catch (_e) {
            return `guest-${crypto.randomUUID()}`;
        }
    };

    // Handle template like (unified for library and community)
    const handleTemplateLike = async (template: any) => {
        try {
            const guestId = getGuestId();
            const response = await fetch(`/api/assistant-templates/${template.id}/like`, {
                method: 'POST',
                headers: { 'x-guest-id': guestId },
            });

            if (response.ok) {
                const data = await response.json();
                if (template.type === 'community') {
                    setCommunityTemplates(prev => prev.map(t => 
                        t.id === template.id 
                            ? { ...t, likeCount: data.likeCount, isLiked: data.liked }
                            : t
                    ));
                } else {
                    setTemplates(prev => prev.map(t => 
                        t.id === template.id 
                            ? { ...t, likeCount: data.likeCount, isLiked: data.liked } as any
                            : t
                    ));
                }
            }
        } catch (err) {
            console.error('Error toggling like:', err);
        }
    };

    // Handle template share (for both library and community)
    const handleTemplateShare = async (template: any) => {
        try {
            // Fetch workflow for the template and create a shared snapshot
            const res = await fetch(`/api/assistant-templates/${template.id}`);
            if (!res.ok) throw new Error('Failed to fetch template for sharing');
            const data = await res.json();

            const shareResp = await fetch('/api/shared-workflow', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ workflow: data.workflow }),
            });
            if (!shareResp.ok) throw new Error('Failed to create shared workflow');
            const shareData = await shareResp.json();
            const url = `${window.location.origin}/projects?shared=${shareData.id}`;
            await navigator.clipboard.writeText(url);
            console.log('URL copied to clipboard');
        } catch (err) {
            console.error('Failed to copy shared URL:', err);
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
        fetchCommunityTemplates();
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
                try {
                    const isMongoId = !!urlTemplate && /^[a-f0-9]{24}$/i.test(urlTemplate);
                    if (urlTemplate && isMongoId) {
                        // New-style share: template is an assistant-templates id
                        const res = await fetch(`/api/assistant-templates/${urlTemplate}`);
                        if (!res.ok) throw new Error('Failed to fetch shared template');
                        const data = await res.json();
                        await createProjectFromJsonWithOptions({
                            workflowJson: JSON.stringify(data.workflow),
                            router,
                            onError: (error) => {
                                console.error('Error auto-creating project from template id:', error);
                                setAutoCreateLoading(false);
                            }
                        });
                    } else {
                        // Legacy share using static key
                        await createProjectWithOptions({
                            template: urlTemplate || undefined,
                            prompt: urlPrompt || undefined,
                            router,
                            onError: (error) => {
                                console.error('Error auto-creating project:', error);
                                setAutoCreateLoading(false);
                                if (urlPrompt) {
                                    setUserPrompt(urlPrompt);
                                }
                            }
                        });
                    }
                } catch (err) {
                    console.error('Error handling template auto-create:', err);
                    setAutoCreateLoading(false);
                }
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
                            <Tabs defaultSelectedKey="new" selectedKey={selectedTab} onSelectionChange={(key) => {
                                setSelectedTab(key as string);
                            }} className="w-full">
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

                    {/* Unified Templates Section - Only show for New Assistant tab */}
                    {selectedTab === 'new' && SHOW_PREBUILT_CARDS && (
                        <div className="max-w-5xl mx-auto mt-16">
                            <UnifiedTemplatesSection
                                prebuiltTemplates={templates.map(template => ({
                                    id: template.id,
                                    name: template.name,
                                    description: template.description,
                                    category: template.category || 'Other',
                                    tools: template.tools,
                                    type: 'prebuilt' as const,
                                    likeCount: (template as any).likeCount || 0,
                                    isLiked: (template as any).isLiked || false,
                                }))}
                                communityTemplates={communityTemplates.map(template => ({
                                    id: template.id,
                                    name: template.name,
                                    description: template.description,
                                    category: template.category,
                                    authorName: template.authorName,
                                    isAnonymous: template.isAnonymous,
                                    likeCount: template.likeCount,
                                    createdAt: template.publishedAt,
                                    isLiked: template.isLiked,
                                    type: 'community' as const,
                                }))}
                                loading={templatesLoading || communityTemplatesLoading}
                                error={templatesError || communityTemplatesError}
                                onTemplateClick={handleTemplateSelect}
                                onRetry={() => {
                                    fetchTemplates();
                                    fetchCommunityTemplates();
                                }}
                                loadingItemId={loadingTemplateId}
                                onLike={handleTemplateLike}
                                onShare={handleTemplateShare}
                                getUniqueTools={getUniqueTools}
                            />
                        </div>
                    )}
                </div>
            </div>
            )}
        </>
    );
}
