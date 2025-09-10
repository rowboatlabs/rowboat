"use client";
import React from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip, Input, ButtonGroup } from "@heroui/react";
import { Button as CustomButton } from "@/components/ui/button";
import { RadioIcon, RedoIcon, UndoIcon, RocketIcon, PenLine, AlertTriangle, DownloadIcon, SettingsIcon, ChevronDownIcon, ZapIcon, Clock, Plug, MessageCircleIcon, ShareIcon } from "lucide-react";
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
    viewMode: "two_agents_chat" | "two_agents_skipper" | "two_chat_skipper" | "three_all";
    hasAgentInstructionChanges: boolean;
    hasPlaygroundTested: boolean;
    hasPublished: boolean;
    hasClickedUse: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onDownloadJSON: () => void;
    onPublishWorkflow: () => void;
    onChangeMode: (mode: 'draft' | 'live') => void;
    onRevertToLive: () => void;
    onTogglePanel: () => void;
    onSetViewMode: (mode: "two_agents_chat" | "two_agents_skipper" | "two_chat_skipper" | "three_all") => void;
    hasAgents?: boolean;
    onUseAssistantClick: () => void;
    onStartNewChatAndFocus: () => void;
    onStartBuildTour?: () => void;
    onStartTestTour?: () => void;
    onStartPublishTour?: () => void;
    onStartUseTour?: () => void;
    onShareWorkflow: () => void;
    shareUrl: string | null;
    onCopyShareUrl: () => void;
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
    viewMode,
    hasAgentInstructionChanges,
    hasPlaygroundTested,
    hasPublished,
    hasClickedUse,
    onUndo,
    onRedo,
    onDownloadJSON,
    onPublishWorkflow,
    onChangeMode,
    onRevertToLive,
    onTogglePanel,
    onSetViewMode,
    hasAgents = true,
    onUseAssistantClick,
    onStartNewChatAndFocus,
    onStartBuildTour,
    onStartTestTour,
    onStartPublishTour,
    onStartUseTour,
    onShareWorkflow,
    shareUrl,
    onCopyShareUrl,
}: TopBarProps) {
    const router = useRouter();
    const params = useParams();
    const projectId = typeof (params as any).projectId === 'string' ? (params as any).projectId : (params as any).projectId?.[0];
    // Progress bar steps with completion logic and current step detection
    const step1Complete = hasAgentInstructionChanges;
    const step2Complete = hasPlaygroundTested && hasAgentInstructionChanges;
    const step3Complete = hasPublished && hasPlaygroundTested && hasAgentInstructionChanges;
    const step4Complete = hasClickedUse && hasPublished && hasPlaygroundTested && hasAgentInstructionChanges;
    
    // Determine current step (first incomplete step)
    const currentStep = !step1Complete ? 1 : !step2Complete ? 2 : !step3Complete ? 3 : !step4Complete ? 4 : null;
    
    const progressSteps: ProgressStep[] = [
        { id: 1, label: "Build: Ask the copilot to create your assistant. Add tools and connect data sources.", completed: step1Complete, isCurrent: currentStep === 1 },
        { id: 2, label: "Test: Test out your assistant by chatting with it. Use 'Fix' and 'Explain' to improve it.", completed: step2Complete, isCurrent: currentStep === 2 },
        { id: 3, label: "Publish: Make it live with the Publish button. You can always switch back to draft.", completed: step3Complete, isCurrent: currentStep === 3 },
        { id: 4, label: "Use: Click the 'Use Assistant' button to chat, set triggers (like emails), or connect via API.", completed: step4Complete, isCurrent: currentStep === 4 },
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

                    {/* Show divider and mode indicator */}
                    {isLive && <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>}
                    {isLive ? (
                        <Button
                            variant="solid"
                            size="sm"
                            onPress={() => onChangeMode('draft')}
                            className="gap-2 px-3 h-8 bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-300 font-medium text-sm border border-gray-200 dark:border-gray-600 shadow-sm"
                            startContent={<PenLine size={14} />}
                        >
                            Switch to draft
                        </Button>
                    ) : (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-medium text-xs rounded-full">
                            <PenLine size={12} />
                            <span>Draft</span>
                        </div>
                    )}
                </div>

                {/* Progress Bar - Center */}
                <div className="flex-1 flex justify-center">
                    <ProgressBar 
                        steps={progressSteps}
                        onStepClick={(step) => {
                            if (step.id === 1 && onStartBuildTour) onStartBuildTour();
                            if (step.id === 2 && onStartTestTour) onStartTestTour();
                            if (step.id === 3 && onStartPublishTour) onStartPublishTour();
                            if (step.id === 4 && onStartUseTour) onStartUseTour();
                        }}
                    />
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
                    
                    
                    {!isLive && <div className="flex items-center gap-0.5">
                        <CustomButton
                            variant="primary"
                            size="sm"
                            onClick={onUndo}
                            disabled={!canUndo}
                            className="min-w-8 h-8 px-2 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:bg-gray-25 disabled:text-gray-400"
                            showHoverContent={true}
                            hoverContent="Undo"
                        >
                            <UndoIcon className="w-3.5 h-3.5" />
                        </CustomButton>
                        <CustomButton
                            variant="primary"
                            size="sm"
                            onClick={onRedo}
                            disabled={!canRedo}
                            className="min-w-8 h-8 px-2 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:bg-gray-25 disabled:text-gray-400"
                            showHoverContent={true}
                            hoverContent="Redo"
                        >
                            <RedoIcon className="w-3.5 h-3.5" />
                        </CustomButton>
                    </div>}
                    
                    {/* View controls (hidden in live mode) */}
                    {!isLive && (<div className="flex items-center gap-2 mr-2">
                        {(() => {
                            // Current visibility booleans
                            const showAgents = viewMode !== "two_chat_skipper";
                            const showChat = viewMode !== "two_agents_skipper";
                            const showSkipper = viewMode !== "two_agents_chat";

                            // Determine selected radio option
                            type RadioKey = 'show-all' | 'hide-agents' | 'hide-chat' | 'hide-skipper';
                            let selectedKey: RadioKey = 'show-all';
                            if (!(showAgents && showChat && showSkipper)) {
                                if (!showAgents) selectedKey = 'hide-agents';
                                else if (!showChat) selectedKey = 'hide-chat';
                                else if (!showSkipper) selectedKey = 'hide-skipper';
                            }

                            // Map radio selection to viewMode
                            const setByKey = (key: RadioKey) => {
                                switch (key) {
                                    case 'show-all':
                                        onSetViewMode('three_all');
                                        break;
                                    case 'hide-agents':
                                        onSetViewMode('two_chat_skipper');
                                        break;
                                    case 'hide-chat':
                                        onSetViewMode('two_agents_skipper');
                                        break;
                                    case 'hide-skipper':
                                        onSetViewMode('two_agents_chat');
                                        break;
                                }
                            };

                            // Disable rules
                            const allDisabled = !hasAgents;
                            const disableShowAll = allDisabled;
                            const disableHideAgents = allDisabled;
                            const disableHideChat = allDisabled || !hasAgents;
                            const disableHideSkipper = allDisabled;

                            return (
                        <Dropdown>
                            <DropdownTrigger>
                                <Button variant="light" size="sm" aria-label="Layout options" className="h-8 min-w-0 bg-transparent text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/50 border border-transparent gap-1 px-2">
                                    {/* Unified icon: 3-pane visual */}
                                    <svg width="20" height="14" viewBox="0 0 22 16" aria-hidden="true">
                                        <rect x="1" y="1" width="20" height="14" rx="2" fill="none" stroke="currentColor" opacity=".55" />
                                        <rect x="2.3" y="2.5" width="5.5" height="11" rx="1.2" fill="currentColor" opacity=".8" />
                                        <rect x="8.5" y="2.5" width="6" height="11" rx="1.2" fill="currentColor" opacity=".5" />
                                        <rect x="15.5" y="2.5" width="5.5" height="11" rx="1.2" fill="currentColor" opacity=".4" />
                                    </svg>
                                    <ChevronDownIcon size={14} />
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu aria-label="Choose layout" selectionMode="single" selectedKeys={[selectedKey]} closeOnSelect={true} onSelectionChange={(keys) => {
                                // When there are no agents, treat the menu as read-only
                                const allDisabled = !hasAgents;
                                if (allDisabled) return;
                                const key = Array.from(keys as Set<string>)[0] as RadioKey;
                                if (key === 'hide-chat' && disableHideChat) return;
                                setByKey(key);
                            }}>
                                <DropdownItem key="show-all" isDisabled={disableShowAll} className={selectedKey==='show-all' ? 'bg-zinc-100 dark:bg-zinc-800' : ''} startContent={<input type="radio" readOnly checked={selectedKey==='show-all'} className="accent-zinc-600 dark:accent-zinc-300" />}>Show All</DropdownItem>
                                <DropdownItem key="hide-agents" isDisabled={disableHideAgents} className={selectedKey==='hide-agents' ? 'bg-zinc-100 dark:bg-zinc-800' : ''} startContent={<input type="radio" readOnly checked={selectedKey==='hide-agents'} className="accent-zinc-600 dark:accent-zinc-300" />}>Hide Agents</DropdownItem>
                                <DropdownItem key="hide-chat" isDisabled={disableHideChat} className={selectedKey==='hide-chat' ? 'bg-zinc-100 dark:bg-zinc-800' : ''} startContent={<input type="radio" readOnly checked={selectedKey==='hide-chat'} className="accent-zinc-600 dark:accent-zinc-300" />}>Hide Chat</DropdownItem>
                                <DropdownItem key="hide-skipper" isDisabled={disableHideSkipper} className={selectedKey==='hide-skipper' ? 'bg-zinc-100 dark:bg-zinc-800' : ''} startContent={<input type="radio" readOnly checked={selectedKey==='hide-skipper'} className="accent-zinc-600 dark:accent-zinc-300" />}>Hide Skipper</DropdownItem>
                            </DropdownMenu>
                        </Dropdown>
                            );
                        })()}
                    </div>)}

                    {/* Deploy CTA - always visible */}
                    <div className="flex items-center gap-3">
                        {isLive ? (
                            <>
                                <Dropdown>
                                    <DropdownTrigger>
                                        <Button
                                            variant="solid"
                                            size="sm"
                                            className="gap-2 px-3 h-8 bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 font-semibold text-sm border border-blue-200 dark:border-blue-700 shadow-sm"
                                            startContent={<Plug size={14} />}
                                            onPress={onUseAssistantClick}
                                        >
                                            Use Assistant
                                            <ChevronDownIcon size={12} />
                                        </Button>
                                    </DropdownTrigger>
                                    <DropdownMenu aria-label="Assistant access options">
                                        <DropdownItem
                                            key="chat"
                                            startContent={<MessageCircleIcon size={16} />}
                                            onPress={() => { 
                                                onUseAssistantClick();
                                                onStartNewChatAndFocus();
                                            }}
                                        >
                                            Chat with Assistant
                                        </DropdownItem>
                                        <DropdownItem
                                            key="api-sdk"
                                            startContent={<SettingsIcon size={16} />}
                                            onPress={() => { 
                                                onUseAssistantClick();
                                                if (projectId) { router.push(`/projects/${projectId}/config`); } 
                                            }}
                                        >
                                            API & SDK Settings
                                        </DropdownItem>
                                        <DropdownItem
                                            key="manage-triggers"
                                            startContent={<ZapIcon size={16} />}
                                            onPress={() => { 
                                                onUseAssistantClick();
                                                if (projectId) { router.push(`/projects/${projectId}/manage-triggers`); } 
                                            }}
                                        >
                                            Manage Triggers
                                        </DropdownItem>
                                    </DropdownMenu>
                                </Dropdown>

                                <div className="flex items-center gap-2 ml-2">
                                    {publishing && <Spinner size="sm" />}
                                    <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5">
                                        <RadioIcon size={16} />
                                        Live workflow
                                    </div>
                                    <Tooltip content="Share Assistant">
                                        <button
                                            onClick={onShareWorkflow}
                                            className="p-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                            aria-label="Share Assistant"
                                            type="button"
                                        >
                                            <ShareIcon size={20} />
                                        </button>
                                    </Tooltip>
                                    {shareUrl && (
                                        <Tooltip content="Copy share URL">
                                            <button
                                                onClick={onCopyShareUrl}
                                                className="px-2 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded-md transition-colors"
                                                type="button"
                                            >
                                                Copy URL
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Tooltip content="Download Assistant JSON">
                                        <button
                                            onClick={onDownloadJSON}
                                            className="p-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors cursor-pointer"
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
                                    size="sm"
                                    onPress={onPublishWorkflow}
                                    className="gap-2 px-3 h-8 bg-green-100 hover:bg-green-200 text-green-800 font-semibold text-sm rounded-r-none border border-green-300 shadow-sm"
                                    startContent={<RocketIcon size={14} />}
                                    data-tour-target="deploy"
                                >
                                    Publish
                                </Button>
                                <Dropdown>
                                    <DropdownTrigger>
                                        <Button
                                            variant="solid"
                                            size="sm"
                                            className="min-w-0 px-2 h-8 bg-green-100 hover:bg-green-200 text-green-800 rounded-l-none border border-l-0 border-green-300 shadow-sm"
                                        >
                                            <ChevronDownIcon size={12} />
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
                                    <Tooltip content="Share Assistant">
                                        <button
                                            onClick={onShareWorkflow}
                                            className="p-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors"
                                            aria-label="Share Assistant"
                                            type="button"
                                        >
                                            <ShareIcon size={20} />
                                        </button>
                                    </Tooltip>
                                    {shareUrl && (
                                        <Tooltip content="Copy share URL">
                                            <button
                                                onClick={onCopyShareUrl}
                                                className="px-2 py-1 text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:hover:bg-indigo-900/50 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 rounded-md transition-colors"
                                                type="button"
                                            >
                                                Copy URL
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Tooltip content="Download Assistant JSON">
                                        <button
                                            onClick={onDownloadJSON}
                                            className="p-1.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors cursor-pointer"
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
