"use client";
import React from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip, Input } from "@heroui/react";
import { Button as CustomButton } from "@/components/ui/button";
import { RadioIcon, RedoIcon, UndoIcon, RocketIcon, PenLine, AlertTriangle, DownloadIcon, SettingsIcon, ChevronDownIcon, ZapIcon, Clock, Plug } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { ProgressBar, ProgressStep } from "@/components/ui/progress-bar";

interface TopBarProps {
    localProjectName: string;
    projectNameError: string | null;
    onProjectNameChange: (value: string) => void;
    onProjectNameCommit: (value: string) => Promise<void>;
    publishing: boolean;
    isLive: boolean;
    showCopySuccess: boolean;
    showBuildModeBanner: boolean;
    canUndo: boolean;
    canRedo: boolean;
    activePanel: 'playground' | 'copilot';
    onUndo: () => void;
    onRedo: () => void;
    onDownloadJSON: () => void;
    onPublishWorkflow: () => void;
    onChangeMode: (mode: 'draft' | 'live') => void;
    onRevertToLive: () => void;
    onTogglePanel: () => void;
}

export function TopBar({
    localProjectName,
    projectNameError,
    onProjectNameChange,
    onProjectNameCommit,
    publishing,
    isLive,
    showCopySuccess,
    showBuildModeBanner,
    canUndo,
    canRedo,
    activePanel,
    onUndo,
    onRedo,
    onDownloadJSON,
    onPublishWorkflow,
    onChangeMode,
    onRevertToLive,
    onTogglePanel,
}: TopBarProps) {
    const router = useRouter();
    const params = useParams();
    const projectId = typeof (params as any).projectId === 'string' ? (params as any).projectId : (params as any).projectId?.[0];
    
    // Progress bar steps with completion logic and detailed tooltips
    const progressSteps: ProgressStep[] = [
        { id: 1, label: "Build: Ask the copilot to build the assistant you want and apply the changes", completed: false },
        { id: 2, label: "Test: Chat with the assistant in the playground. You can ask the copilot to make changes or use the handy 'Fix' and 'Explain' buttons in the chat", completed: false },
        { id: 3, label: "Publish: Make the assistant live by clicking the Publish button on the right", completed: false },
        { id: 4, label: "Use: Use the assistant by chatting with it, adding triggers like incoming emails, or integrating through the API", completed: false },
    ];

    return (
        <div className="rounded-xl bg-white/70 dark:bg-zinc-800/70 shadow-sm backdrop-blur-sm border border-zinc-200 dark:border-zinc-800 px-5 py-2">
            <div className="flex justify-between items-center">
                <div className="workflow-version-selector flex items-center gap-4 px-2 text-gray-800 dark:text-gray-100">
                    {/* Project Name Editor */}
                    <div className="flex flex-col min-w-0 max-w-xs">
                        <Input
                            type="text"
                            value={localProjectName}
                            onChange={(e) => onProjectNameChange(e.target.value)}
                            onBlur={() => onProjectNameCommit(localProjectName)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                }
                            }}
                            isInvalid={!!projectNameError}
                            errorMessage={projectNameError}
                            placeholder="Project name..."
                            variant="bordered"
                            size="sm"
                            classNames={{
                                base: "max-w-xs",
                                input: "text-base font-semibold px-2",
                                inputWrapper: "min-h-[36px] h-[36px] border-gray-200 dark:border-gray-700 px-0"
                            }}
                        />
                    </div>

                    {/* Show divider and CTA only in live view */}
                    {isLive && <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>}
                    {isLive ? (
                        <Button
                            variant="solid"
                            size="md"
                            onPress={() => onChangeMode('draft')}
                            className="gap-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 font-medium text-sm border border-gray-200 dark:border-gray-600 shadow-sm"
                            startContent={<PenLine size={16} />}
                        >
                            Switch to draft
                        </Button>
                    ) : null}
                </div>

                {/* Progress Bar - Center */}
                <div className="flex-1 flex justify-center">
                    <ProgressBar steps={progressSteps} />
                </div>

                {/* Right side buttons */}
                <div className="flex items-center gap-2">
                    {showCopySuccess && <div className="flex items-center gap-2 mr-4">
                        <div className="text-green-500">Copied to clipboard</div>
                    </div>}
                    
                    {showBuildModeBanner && <div className="flex items-center gap-2 mr-4">
                        <AlertTriangle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                        <div className="text-blue-700 dark:text-blue-300 text-sm">
                            Switched to draft mode. You can now make changes to your workflow.
                        </div>
                    </div>}
                    
                    {isLive && <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 mr-4">
                        <AlertTriangle size={14} />
                        <span>This version is locked.<br />Changes will not be saved.</span>
                    </div>}
                    
                    {!isLive && <>
                        <CustomButton
                            variant="primary"
                            size="sm"
                            onClick={onUndo}
                            disabled={!canUndo}
                            className="bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:bg-gray-25 disabled:text-gray-400"
                            showHoverContent={true}
                            hoverContent="Undo"
                        >
                            <UndoIcon className="w-4 h-4" />
                        </CustomButton>
                        <CustomButton
                            variant="primary"
                            size="sm"
                            onClick={onRedo}
                            disabled={!canRedo}
                            className="bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:bg-gray-25 disabled:text-gray-400"
                            showHoverContent={true}
                            hoverContent="Redo"
                        >
                            <RedoIcon className="w-4 h-4" />
                        </CustomButton>
                    </>}
                    
                    {/* Deploy CTA - always visible */}
                    <div className="flex items-center gap-3">
                        {isLive ? (
                            <>
                                <Dropdown>
                                    <DropdownTrigger>
                                        <Button
                                            variant="solid"
                                            size="md"
                                            className="gap-2 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 font-semibold text-sm border border-blue-200 dark:border-blue-700 shadow-sm"
                                            startContent={<Plug size={16} />}
                                        >
                                            Use Assistant
                                            <ChevronDownIcon size={14} />
                                        </Button>
                                    </DropdownTrigger>
                                    <DropdownMenu aria-label="Assistant access options">
                                        <DropdownItem
                                            key="api-sdk"
                                            startContent={<SettingsIcon size={16} />}
                                            onPress={() => { if (projectId) { router.push(`/projects/${projectId}/config`); } }}
                                        >
                                            API & SDK Settings
                                        </DropdownItem>
                                        <DropdownItem
                                            key="manage-triggers"
                                            startContent={<ZapIcon size={16} />}
                                            onPress={() => { if (projectId) { router.push(`/projects/${projectId}/manage-triggers`); } }}
                                            >
                                            Manage Triggers
                                        </DropdownItem>
                                    </DropdownMenu>
                                </Dropdown>

                                {/* Live workflow label moved here */}
                                <div className="flex items-center gap-2 ml-2">
                                    {publishing && <Spinner size="sm" />}
                                    <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5">
                                        <RadioIcon size={16} />
                                        Live workflow
                                    </div>
                                    <Tooltip content="Download Assistant JSON">
                                        <button
                                            onClick={onDownloadJSON}
                                            className="p-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                            aria-label="Download JSON"
                                            type="button"
                                        >
                                            <DownloadIcon size={20} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex">
                                <Button
                                    variant="solid"
                                    size="md"
                                    onPress={onPublishWorkflow}
                                    className="gap-2 px-4 bg-green-100 hover:bg-green-200 text-green-800 font-semibold text-sm rounded-r-none border border-green-300 shadow-sm"
                                    startContent={<RocketIcon size={16} />}
                                    data-tour-target="deploy"
                                >
                                    Publish
                                </Button>
                                <Dropdown>
                                    <DropdownTrigger>
                                        <Button
                                            variant="solid"
                                            size="md"
                                            className="min-w-0 px-2 bg-green-100 hover:bg-green-200 text-green-800 rounded-l-none border border-l-0 border-green-300 shadow-sm"
                                        >
                                            <ChevronDownIcon size={14} />
                                        </Button>
                                    </DropdownTrigger>
                                    <DropdownMenu aria-label="Deploy actions">
                                        <DropdownItem
                                            key="view-live"
                                            startContent={<RadioIcon size={16} />}
                                            onPress={() => onChangeMode('live')}
                                        >
                                            View live version
                                        </DropdownItem>
                                        <DropdownItem
                                            key="reset-to-live"
                                            startContent={<AlertTriangle size={16} />}
                                            onPress={onRevertToLive}
                                            className="text-red-600 dark:text-red-400"
                                        >
                                            Reset to live version
                                        </DropdownItem>
                                    </DropdownMenu>
                                </Dropdown>
                                </div>

                                {/* Moved draft/live labels and download button here */}
                                <div className="flex items-center gap-2 ml-2">
                                    {publishing && <Spinner size="sm" />}
                                    {isLive && <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5">
                                        <RadioIcon size={16} />
                                        Live workflow
                                    </div>}
                                    {!isLive && <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5">
                                        <PenLine size={16} />
                                        Draft workflow
                                    </div>}
                                    <Tooltip content="Download Assistant JSON">
                                        <button
                                            onClick={onDownloadJSON}
                                            className="p-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                            aria-label="Download JSON"
                                            type="button"
                                        >
                                            <DownloadIcon size={20} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
