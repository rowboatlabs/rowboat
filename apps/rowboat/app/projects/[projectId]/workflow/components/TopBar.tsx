"use client";
import React from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip, Input, ButtonGroup, Checkbox, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
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
    autoPublishEnabled: boolean;
    onToggleAutoPublish: (enabled: boolean) => void;
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
    autoPublishEnabled,
    onToggleAutoPublish,
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
    onStartUseTour,
    onShareWorkflow,
    shareUrl,
    onCopyShareUrl,
}: TopBarProps) {
    const router = useRouter();
    const params = useParams();
    const projectId = typeof (params as any).projectId === 'string' ? (params as any).projectId : (params as any).projectId?.[0];
    
    // Share modal state
    const { isOpen: isShareModalOpen, onOpen: onShareModalOpen, onClose: onShareModalClose } = useDisclosure();
    
    const handleShareClick = () => {
        onShareWorkflow(); // Call the original share function to generate URL
        onShareModalOpen(); // Open the modal
    };
    
    // Progress bar steps with completion logic and current step detection
    const step1Complete = hasAgentInstructionChanges;
    const step2Complete = hasPlaygroundTested && hasAgentInstructionChanges;
    // Keep publish as a prerequisite for Use completion, but remove it from the visual steps
    // Mark "Use" complete as soon as a Use Assistant option is clicked
    const step4Complete = hasClickedUse;
    
    // Determine current step (first incomplete visual step: 1 -> 2 -> 4)
    const currentStep = !step1Complete ? 1 : !step2Complete ? 2 : !step4Complete ? 4 : null;
    
    const progressSteps: ProgressStep[] = [
        { id: 1, label: "Build: Ask the copilot to create your assistant. Add tools and connect data sources.", completed: step1Complete, isCurrent: currentStep === 1 },
        { id: 2, label: "Test: Test out your assistant by chatting with it. Use 'Fix' and 'Explain' to improve it.", completed: step2Complete, isCurrent: currentStep === 2 },
        // Removed the 'Publish' step from the progress bar
        { id: 4, label: "Use: Click the 'Use Assistant' button to chat, set triggers (like emails), or connect via API.", completed: step4Complete, isCurrent: currentStep === 4 },
    ];

    return (
        <>
        <div className="rounded-xl bg-white/70 dark:bg-zinc-800/70 shadow-sm backdrop-blur-sm border border-zinc-200 dark:border-zinc-800 px-5 py-2">
            <div className="flex justify-between items-center">
                <div className="workflow-version-selector flex items-center gap-3 -ml-1 pr-2 text-gray-800 dark:text-gray-100">
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
                                input: "text-sm font-semibold px-2",
                                inputWrapper: "min-h-[36px] h-[36px] border-gray-200 dark:border-gray-700 px-0"
                            }}
                        />
                    </div>

                    {/* Mode pill and auto-publish checkbox */}
                    <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
                    
                    {/* Mode pill */}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-medium text-xs rounded-full">
                        <RadioIcon size={12} />
                        <span>
                            {autoPublishEnabled ? 'Live ' : (isLive ? 'Live ' : 'Draft')}
                        </span>
                    </div>

                    {/* Auto-publish checkbox or Switch to draft button */}
                    {!autoPublishEnabled && isLive ? (
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
                        !isLive && (
                            <div className="flex items-center">
                                <Checkbox
                                    size="sm"
                                    isSelected={autoPublishEnabled}
                                    onValueChange={onToggleAutoPublish}
                                >
                                    Auto-publish
                                </Checkbox>
                            </div>
                        )
                    )}
                </div>

                {/* Progress Bar - Center */}
                <div className="flex-1 flex justify-center">
                    <ProgressBar 
                        steps={progressSteps}
                        onStepClick={(step) => {
                            if (step.id === 1 && onStartBuildTour) onStartBuildTour();
                            if (step.id === 2 && onStartTestTour) onStartTestTour();
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
                            // When there are zero agents, allow only Show All and Hide Chat
                            const zeroAgents = !hasAgents;
                            const disableShowAll = false; // always allow switching to 3-pane view
                            const disableHideAgents = zeroAgents; // cannot hide agents if none exist
                            const disableHideChat = false; // allow hide chat even with zero agents (default)
                            const disableHideSkipper = zeroAgents; // keep skipper visible when no agents

                            return (
                        <Dropdown>
                            <DropdownTrigger>
                                <Button variant="light" size="sm" aria-label="Layout options" className="h-8 min-w-0 bg-transparent text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/50 border border-transparent gap-1 px-2">
                                    {/* 3-pane layout icon */}
                                    <svg width="26" height="18" viewBox="0 0 18 12" aria-hidden="true">
                                        <rect x="0.5" y="0.5" width="17" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
                                        <rect x="2" y="2" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.8" />
                                        <rect x="7" y="2" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.6" />
                                        <rect x="12" y="2" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.4" />
                                    </svg>
                                    <ChevronDownIcon size={14} />
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu aria-label="Choose layout" selectionMode="single" selectedKeys={[selectedKey]} closeOnSelect={true} onSelectionChange={(keys) => {
                                const key = Array.from(keys as Set<string>)[0] as RadioKey;
                                const zeroAgents = !hasAgents;
                                // Allow only permitted options when zero agents
                                if (zeroAgents && key !== 'show-all' && key !== 'hide-chat') return;
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

                    {/* Deploy CTA - conditional based on auto-publish mode */}
                    <div className="flex items-center gap-3">
                        {autoPublishEnabled ? (
                            <>
                                {/* Auto-publish mode: Show Use Assistant button */}
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
                                    <div className="flex">
                                        <Button
                                            variant="solid"
                                            size="sm"
                                            onPress={handleShareClick}
                                            className={`gap-2 px-3 h-8 font-semibold text-sm rounded-r-none border shadow-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border-indigo-300`}
                                            startContent={<ShareIcon size={14} />}
                                        >
                                            Share
                                        </Button>
                                        <Dropdown>
                                            <DropdownTrigger>
                                                <Button
                                                    variant="solid"
                                                    size="sm"
                                                    className={`min-w-0 px-2 h-8 rounded-l-none border border-l-0 shadow-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border-indigo-300`}
                                                >
                                                    <ChevronDownIcon size={12} />
                                                </Button>
                                            </DropdownTrigger>
                                            <DropdownMenu aria-label="Share actions">
                                                <DropdownItem
                                                    key="download-json"
                                                    startContent={<DownloadIcon size={16} />}
                                                    onPress={onDownloadJSON}
                                                >
                                                    Download JSON
                                                </DropdownItem>
                                            </DropdownMenu>
                                        </Dropdown>
                                    </div>
                                </div>
                            </>
                        ) : (
                            // Manual publish mode: Show current publish/live logic
                            isLive ? (
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
                                        <div className="flex">
                                            <Button
                                                variant="solid"
                                                size="sm"
                                                onPress={handleShareClick}
                                                className={`gap-2 px-3 h-8 font-semibold text-sm rounded-r-none border shadow-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border-indigo-300`}
                                                startContent={<ShareIcon size={14} />}
                                            >
                                                Share
                                            </Button>
                                            <Dropdown>
                                                <DropdownTrigger>
                                                    <Button
                                                        variant="solid"
                                                        size="sm"
                                                        className={`min-w-0 px-2 h-8 rounded-l-none border border-l-0 shadow-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border-indigo-300`}
                                                    >
                                                        <ChevronDownIcon size={12} />
                                                    </Button>
                                                </DropdownTrigger>
                                                <DropdownMenu aria-label="Share actions">
                                                    <DropdownItem
                                                        key="download-json"
                                                        startContent={<DownloadIcon size={16} />}
                                                        onPress={onDownloadJSON}
                                                    >
                                                        Download JSON
                                                    </DropdownItem>
                                                </DropdownMenu>
                                            </Dropdown>
                                        </div>
                                    </div>
                                </>) : (
                                // Draft mode in manual publish: Show publish button
                                <>
                                    <div className="flex">
                                    {(!hasAgents) ? (
                                        <Tooltip content="Create agents to publish your assistant">
                                            <span className="inline-flex">
                                                <Button
                                                    variant="solid"
                                                    size="sm"
                                                    onPress={onPublishWorkflow}
                                                    isDisabled
                                                    className={`gap-2 px-3 h-8 font-semibold text-sm rounded-r-none border shadow-sm bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed min-w-[120px]`}
                                                    startContent={<RocketIcon size={14} />}
                                                    data-tour-target="deploy"
                                                >
                                                    Publish
                                                </Button>
                                            </span>
                                        </Tooltip>
                                    ) : (
                                        <Button
                                            variant="solid"
                                            size="sm"
                                            onPress={onPublishWorkflow}
                                            className={`gap-2 px-3 h-8 font-semibold text-sm rounded-r-none border shadow-sm bg-green-100 hover:bg-green-200 text-green-800 border-green-300 min-w-[132px]`}
                                            startContent={<RocketIcon size={14} />}
                                            data-tour-target="deploy"
                                        >
                                            Publish
                                        </Button>
                                    )}
                                    {hasAgents ? (
                                        <Dropdown>
                                            <DropdownTrigger>
                                                <Button
                                                    variant="solid"
                                                    size="sm"
                                                    className={`min-w-0 px-2 h-8 rounded-l-none border border-l-0 shadow-sm bg-green-100 hover:bg-green-200 text-green-800 border-green-300`}
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
                                    ) : (
                                        <Tooltip content="Create agents to publish your assistant">
                                            <span className="inline-flex">
                                                <Button
                                                    variant="solid"
                                                    size="sm"
                                                    isDisabled
                                                    className={`min-w-0 px-2 h-8 rounded-l-none border border-l-0 shadow-sm bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed`}
                                                >
                                                    <ChevronDownIcon size={12} />
                                                </Button>
                                            </span>
                                        </Tooltip>
                                    )}
                                    </div>

                                    <div className="flex items-center gap-2 ml-2">
                                        {publishing && <Spinner size="sm" />}
                                        <div className="flex">
                                            <Button
                                                variant="solid"
                                                size="sm"
                                                onPress={handleShareClick}
                                                className={`gap-2 px-3 h-8 font-semibold text-sm rounded-r-none border shadow-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border-indigo-300`}
                                                startContent={<ShareIcon size={14} />}
                                            >
                                                Share
                                            </Button>
                                            <Dropdown>
                                                <DropdownTrigger>
                                                    <Button
                                                        variant="solid"
                                                        size="sm"
                                                        className={`min-w-0 px-2 h-8 rounded-l-none border border-l-0 shadow-sm bg-indigo-100 hover:bg-indigo-200 text-indigo-800 border-indigo-300`}
                                                    >
                                                        <ChevronDownIcon size={12} />
                                                    </Button>
                                                </DropdownTrigger>
                                                <DropdownMenu aria-label="Share actions">
                                                    <DropdownItem
                                                        key="download-json"
                                                        startContent={<DownloadIcon size={16} />}
                                                        onPress={onDownloadJSON}
                                                    >
                                                        Download JSON
                                                    </DropdownItem>
                                                </DropdownMenu>
                                            </Dropdown>
                                        </div>
                                    </div>
                                </>
                            )
                        )}
                    </div>

                </div>
            </div>
        </div>

        {/* Share Modal */}
        <Modal isOpen={isShareModalOpen} onClose={onShareModalClose} size="lg">
            <ModalContent>
                <ModalHeader className="flex flex-col gap-1">
                    Share Assistant
                </ModalHeader>
                <ModalBody>
                    <div className="space-y-4">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                            Share this assistant with others using the URL below:
                        </p>
                        {shareUrl ? (
                            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                <input
                                    type="text"
                                    value={shareUrl || ''}
                                    readOnly
                                    className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-300 outline-none"
                                />
                                <Button
                                    size="sm"
                                    variant="solid"
                                    onPress={onCopyShareUrl}
                                    className="bg-indigo-100 hover:bg-indigo-200 text-indigo-800"
                                >
                                    Copy
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                <Spinner size="sm" />
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    Generating share URL...
                                </span>
                            </div>
                        )}
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="light" onPress={onShareModalClose}>
                        Close
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
        </>
    );
}
