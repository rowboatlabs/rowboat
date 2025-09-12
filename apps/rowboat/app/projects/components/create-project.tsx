'use client';

import { useEffect, useState, useRef } from "react";
import { createProjectWithOptions, createProjectFromJsonWithOptions } from "../lib/project-creation-utils";
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FolderOpenIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { USE_MULTIPLE_PROJECTS } from "@/app/lib/feature_flags";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";
import { Tooltip } from "@heroui/react";
import { BillingUpgradeModal } from "@/components/common/billing-upgrade-modal";
import { Workflow } from '@/app/lib/types/workflow_types';
import { Modal } from '@/components/ui/modal';
import { Upload, Send, X } from "lucide-react";

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

const TabType = {
    Describe: 'describe',
    Import: 'import',
} as const;

type TabState = typeof TabType[keyof typeof TabType];

const isNotBlankTemplate = (tab: TabState): boolean => true;

const tabStyles = clsx(
    "px-4 py-2 text-sm font-medium",
    "rounded-lg",
    "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20",
    "transition-colors duration-150"
);

const activeTabStyles = clsx(
    "bg-white dark:bg-gray-800",
    "text-gray-900 dark:text-gray-100",
    "shadow-sm",
    "border border-gray-200 dark:border-gray-700"
);

const inactiveTabStyles = clsx(
    "text-gray-600 dark:text-gray-400",
    "hover:bg-gray-50 dark:hover:bg-gray-750"
);

const largeSectionHeaderStyles = clsx(
    "text-lg font-medium",
    "text-gray-900 dark:text-gray-100"
);

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

const tabButtonStyles = clsx(
    "border border-gray-200 dark:border-gray-700"
);

const selectedTabStyles = clsx(
    tabButtonStyles,
    "text-gray-900 dark:text-gray-100",
    "text-base"
);

const unselectedTabStyles = clsx(
    tabButtonStyles,
    "text-gray-900 dark:text-gray-100",
    "text-sm"
);

interface CreateProjectProps {
    defaultName: string;
    onOpenProjectPane: () => void;
    isProjectPaneOpen: boolean;
    hideHeader?: boolean;
}

export function CreateProject({ defaultName, onOpenProjectPane, isProjectPaneOpen, hideHeader = false }: CreateProjectProps) {
    const [selectedTab, setSelectedTab] = useState<TabState>(TabType.Describe);
    const [customPrompt, setCustomPrompt] = useState("");
    const [name, setName] = useState(defaultName);
    const [promptError, setPromptError] = useState<string | null>(null);
    const [billingError, setBillingError] = useState<string | null>(null);
    const [importedJson, setImportedJson] = useState<string | null>(null);
    const [importedFilename, setImportedFilename] = useState<string | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const router = useRouter();
    const [importLoading, setImportLoading] = useState(false);
    const [autoCreateLoading, setAutoCreateLoading] = useState(false);

    const searchParams = useSearchParams();
    const urlPrompt = searchParams.get('prompt');
    const urlTemplate = searchParams.get('template');
    const sharedId = searchParams.get('shared');
    const importUrl = searchParams.get('importUrl');

    // Add this effect to update name when defaultName changes
    useEffect(() => {
        setName(defaultName);
    }, [defaultName]);

    // Pre-populate prompt from URL if available
    useEffect(() => {
        if (urlPrompt && !customPrompt) {
            setCustomPrompt(urlPrompt);
        }
    }, [urlPrompt, customPrompt]);

    // Add effect to handle URL parameters for auto-creation
    useEffect(() => {
        const handleAutoCreate = async () => {
            // Auto-create from template/prompt, or import from shared/id/url
            if ((urlPrompt || urlTemplate || sharedId || importUrl) && !importLoading && !autoCreateLoading) {
                setAutoCreateLoading(true);
                try {
                    if (sharedId || importUrl) {
                        // Fetch workflow JSON via our API route
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
                                setBillingError(error instanceof Error ? error.message : String(error));
                            }
                        });
                    } else {
                        await createProjectWithOptions({
                            template: urlTemplate || undefined,
                            prompt: urlPrompt || undefined,
                            router,
                            onError: (error) => {
                                // Auto-creation failed, show the form instead
                                setBillingError(error instanceof Error ? error.message : String(error));
                                setAutoCreateLoading(false);
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error auto-creating project:', error);
                    setBillingError(error instanceof Error ? error.message : String(error));
                    setAutoCreateLoading(false);
                }
            }
        };

        handleAutoCreate();
    }, [urlPrompt, urlTemplate, sharedId, importUrl, importLoading, autoCreateLoading, router]);

    // Inject glow animation styles
    useEffect(() => {
        const styleSheet = document.createElement("style");
        styleSheet.innerText = glowStyles;
        document.head.appendChild(styleSheet);

        return () => {
            document.head.removeChild(styleSheet);
        };
    }, []);

    // Removed dropdownRef and isExamplesDropdownOpen effect

    const handleTabChange = (tab: TabState) => {
        setSelectedTab(tab);
        setImportError(null);
        if (tab === TabType.Describe) {
            setCustomPrompt('');
            setImportedJson(null);
            setImportedFilename(null);
        }
    };

    // Open file chooser when Import JSON is clicked
    const handleImportJsonClick = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setSelectedTab(TabType.Import);
        setTimeout(() => {
            fileInputRef.current?.click();
        }, 0);
    };

    // Handle file selection
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            // If no file selected, revert to describe view
            setSelectedTab(TabType.Describe);
            return;
        }
        setImportLoading(true);
        setImportError(null);
        try {
            const text = await file.text();
            let parsed = Workflow.safeParse(JSON.parse(text));
            if (!parsed.success) {
                setImportError('Invalid workflow JSON: ' + JSON.stringify(parsed.error.issues));
                setImportModalOpen(true);
                setImportLoading(false);
                setImportedJson(null);
                setImportedFilename(null);
                setSelectedTab(TabType.Describe);
                return;
            }
            setImportedJson(text);
            setImportedFilename(file.name);
            setSelectedTab(TabType.Import);
        } catch (err) {
            setImportError('Invalid JSON: ' + (err instanceof Error ? err.message : String(err)));
            setImportModalOpen(true);
            setImportedJson(null);
            setImportedFilename(null);
            setSelectedTab(TabType.Describe);
        } finally {
            setImportLoading(false);
        }
    };

    // Allow user to pick another file
    const handleChooseAnother = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setImportedJson(null);
        setImportedFilename(null);
        setTimeout(() => {
            fileInputRef.current?.click();
        }, 0);
    };

    // Remove imported file with X button
    const handleRemoveImportedFile = () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
        setImportedJson(null);
        setImportedFilename(null);
        setSelectedTab(TabType.Describe);
    };

    async function handleSubmit() {
        try {
            if (importedJson) {
                // Use imported JSON
                await createProjectFromJsonWithOptions({
                    workflowJson: importedJson,
                    router,
                    onError: (error) => {
                        setBillingError(error instanceof Error ? error.message : String(error));
                    }
                });
                return;
            }
            
            if (!customPrompt.trim()) {
                setPromptError("Prompt cannot be empty");
                return;
            }
            
            await createProjectWithOptions({
                template: urlTemplate || undefined,
                prompt: customPrompt,
                router,
                onError: (error) => {
                    setBillingError(error instanceof Error ? error.message : String(error));
                }
            });
        } catch (error) {
            console.error('Error creating project:', error);
        }
    }

    async function handleSubmitWithTemplate(template: string) {
        await createProjectWithOptions({
            template,
            router,
            onError: (error) => {
                setBillingError(error instanceof Error ? error.message : String(error));
            }
        });
    }

    return (
        <>
            <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />
            <div className={clsx(
                "overflow-auto",
                !USE_MULTIPLE_PROJECTS && "max-w-none px-12 py-12",
                USE_MULTIPLE_PROJECTS && !isProjectPaneOpen && "col-span-full"
            )}>
                <section className={clsx(
                    "card h-full",
                    !USE_MULTIPLE_PROJECTS && "px-24",
                    USE_MULTIPLE_PROJECTS && "px-8"
                )}>
                    {USE_MULTIPLE_PROJECTS && !hideHeader && (
                        <>
                            <div className="px-4 pt-4 pb-6 flex justify-between items-center">
                                <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                                    Create new assistant
                                </h1>
                                {!isProjectPaneOpen && (
                                    <Button
                                        onClick={onOpenProjectPane}
                                        variant="primary"
                                        size="md"
                                        startContent={<FolderOpenIcon className="w-4 h-4" />}
                                    >
                                        View Existing Projects
                                    </Button>
                                )}
                            </div>
                            <HorizontalDivider />
                        </>
                    )}
                    
                    {/* Show loading state when auto-creating */}
                    {autoCreateLoading && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mb-4"></div>
                            <p className="text-gray-600 dark:text-gray-400">
                                Creating your assistant...
                            </p>
                        </div>
                    )}
                    
                    {/* Show form if not auto-creating */}
                    {!autoCreateLoading && (
                        <form
                            id="create-project-form"
                            action={undefined}
                            className="pt-6 pb-16 space-y-12"
                            onSubmit={e => { e.preventDefault(); handleSubmit(); }}
                        >
                            {/* Main Section: What do you want to build? and Import JSON */}
                            <div className="flex flex-col gap-6">
                                <div className="flex w-full items-center">
                                    <label className={largeSectionHeaderStyles}>
                                        ✏️ What do you want to build?
                                    </label>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-center gap-2">
                                            <p className="text-xs text-gray-600 dark:text-gray-400">
                                                In the next step, our AI copilot will create agents for you, complete with mock-tools.
                                            </p>
                                            <Tooltip content={<div>If you already know the specific agents and tools you need, mention them below.<br /><br />Specify &apos;internal agents&apos; for task agents that will not interact with the user and &apos;user-facing agents&apos; for conversational agents that will interact with users.</div>} className="max-w-[560px]">
                                                <InformationCircleIcon className="w-4 h-4 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 cursor-help" />
                                            </Tooltip>
                                        </div>
                                        {/* If a file is imported, show filename, cross button, and create button. Otherwise, show compose box. */}
                                        {importedJson ? (
                                            <div className="flex flex-col items-start gap-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex items-center bg-transparent border border-gray-300 dark:border-gray-700 rounded-full px-3 h-8 shadow-sm">
                                                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[160px]">{importedFilename}</span>
                                                        <button
                                                            type="button"
                                                            onClick={handleRemoveImportedFile}
                                                            className="ml-1 p-1 rounded-full transition-colors text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 focus:outline-none"
                                                            aria-label="Remove imported file"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <Button
                                                    type="submit"
                                                    variant="primary"
                                                    size="lg"
                                                    className="mt-2"
                                                >
                                                    Create assistant
                                                </Button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="relative group flex flex-col">
                                                    <div className="relative">
                                                        <Textarea
                                                            value={customPrompt}
                                                            onChange={(e) => {
                                                                setCustomPrompt(e.target.value);
                                                                setPromptError(null);
                                                            }}
                                                            placeholder="Example: Create a customer support assistant that can handle product inquiries and returns"
                                                            className={clsx(
                                                                textareaStyles,
                                                                "text-base",
                                                                "text-gray-900 dark:text-gray-100",
                                                                promptError && "border-red-500 focus:ring-red-500/20",
                                                                !customPrompt && emptyTextareaStyles,
                                                                "pr-14" // more space for send button
                                                            )}
                                                            style={{ minHeight: "120px" }}
                                                            autoFocus
                                                            autoResize
                                                            required
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter' && !e.shiftKey && !importedJson) {
                                                                    e.preventDefault();
                                                                    handleSubmit();
                                                                }
                                                            }}
                                                        />
                                                        <div className="absolute right-3 bottom-3 z-10">
                                                            <button
                                                                type="submit"
                                                                disabled={importLoading || !customPrompt.trim()}
                                                                className={clsx(
                                                                    "rounded-full p-2",
                                                                    customPrompt.trim()
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
                                                
                                                {/* Separation line with OR */}
                                                <div className="relative my-6">
                                                    <div className="absolute inset-0 flex items-center">
                                                        <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                                                    </div>
                                                    <div className="relative flex justify-center text-sm">
                                                        <span className="bg-white dark:bg-gray-900 px-3 text-gray-500 dark:text-gray-400">OR</span>
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
                                                        className="bg-white dark:bg-white text-gray-900 hover:bg-gray-50 border border-gray-300 dark:border-gray-300"
                                                    >
                                                        Import JSON
                                                    </Button>
                                                    <Button
                                                        variant="primary"
                                                        size="sm"
                                                        onClick={() => {
                                                            handleSubmitWithTemplate('default');
                                                        }}
                                                        type="button"
                                                        className="bg-white dark:bg-white text-gray-900 hover:bg-gray-50 border border-gray-300 dark:border-gray-300"
                                                    >
                                                        I&apos;ll build it myself
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </form>
                    )}
                </section>
            </div>
            <BillingUpgradeModal
                isOpen={!!billingError}
                onClose={() => setBillingError(null)}
                errorMessage={billingError || ''}
            />
            <Modal
                isOpen={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                title="Import Error"
            >
                <div className="text-red-500 text-sm whitespace-pre-wrap">
                    {importError}
                </div>
            </Modal>
        </>
    );
}
