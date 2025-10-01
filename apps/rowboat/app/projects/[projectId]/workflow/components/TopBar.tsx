    "use client";
import React from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip, Input, ButtonGroup, Checkbox, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Textarea, Select, SelectItem, Chip, Radio, RadioGroup } from "@heroui/react";
import { Button as CustomButton } from "@/components/ui/button";
import { RadioIcon, RedoIcon, UndoIcon, RocketIcon, PenLine, AlertTriangle, DownloadIcon, SettingsIcon, ChevronDownIcon, ZapIcon, Clock, Plug, MessageCircleIcon, ShareIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { ProgressBar, ProgressStep } from "@/components/ui/progress-bar";
import { useUser } from '@auth0/nextjs-auth0';
import { useState, useEffect } from "react";
import { SHOW_COMMUNITY_PUBLISH } from "@/app/lib/feature_flags";

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
    shareMode: 'url' | 'community';
    setShareMode: (mode: 'url' | 'community') => void;
    communityData: {
        name: string;
        description: string;
        category: string;
        tags: string[];
        isAnonymous: boolean;
        copilotPrompt: string;
    };
    setCommunityData: (data: any) => void;
    onCommunityPublish: () => void;
    communityPublishing: boolean;
    communityPublishSuccess: boolean;
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
    shareMode,
    setShareMode,
    communityData,
    setCommunityData,
    onCommunityPublish,
    communityPublishing,
    communityPublishSuccess,
}: TopBarProps) {
    const router = useRouter();
    const params = useParams();
    const projectId = typeof (params as any).projectId === 'string' ? (params as any).projectId : (params as any).projectId?.[0];
    
    // Share modal state
    const { isOpen: isShareModalOpen, onOpen: onShareModalOpen, onClose: onShareModalClose } = useDisclosure();
    const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure();
    const [acknowledged, setAcknowledged] = useState(false);
    const [copyButtonText, setCopyButtonText] = useState('Copy');
    
    const handleShareClick = () => {
        onShareWorkflow(); // Call the original share function to generate URL
        onShareModalOpen(); // Open the modal
    };

    const handleCopyUrl = () => {
        onCopyShareUrl(); // Call the original copy function
        setCopyButtonText('Copied!');
        setTimeout(() => {
            setCopyButtonText('Copy');
        }, 2000); // Reset after 2 seconds
    };

    // After successful community publish, briefly show success and then close modal
    useEffect(() => {
        if (communityPublishSuccess) {
            const timer = setTimeout(() => {
                onShareModalClose();
            }, 1200);
            return () => clearTimeout(timer);
        }
    }, [communityPublishSuccess, onShareModalClose]);

    const { user } = useUser();
    
    const getUserDisplayName = () => {
        if (!user) return 'Anonymous';
        return user.name ?? user.email ?? 'Anonymous';
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
                    
                    {/* Layout dropdown removed per design */}

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
                                            className={!isLive ? 'hidden' : ''}
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
        <Modal 
            isOpen={isShareModalOpen} 
            onClose={onShareModalClose} 
            size="2xl" 
            scrollBehavior="inside"
            classNames={{
                base: "bg-white dark:bg-gray-900 max-h-[90vh]",
                header: "border-b border-gray-200 dark:border-gray-700 pb-4 flex-shrink-0",
                body: "py-6 overflow-y-auto flex-1",
                footer: "border-t border-gray-200 dark:border-gray-700 pt-4 flex-shrink-0"
            }}
        >
            <ModalContent>
                <ModalHeader className="flex flex-col gap-1">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Share Assistant</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 font-normal">Choose how you&apos;d like to share your assistant</p>
                </ModalHeader>
                <ModalBody>
                    <div className="space-y-8">
                        {/* Quick Share Section */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                    <ShareIcon size={16} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">Quick Share</h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Share with a direct link</p>
                                </div>
                            </div>
                            
                            {shareUrl ? (
                                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                    <div className="flex-1 min-w-0">
                                        <input
                                            type="text"
                                            value={shareUrl || ''}
                                            readOnly
                                            className="w-full bg-transparent text-sm text-gray-700 dark:text-gray-300 outline-none font-mono focus:outline-none !focus:ring-0 !focus:ring-offset-0 !ring-0 !ring-offset-0"
                                        />
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="solid"
                                        onPress={handleCopyUrl}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium"
                                    >
                                        {copyButtonText}
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                                    <Spinner size="sm" />
                                    <span className="text-sm text-gray-500 dark:text-gray-400">
                                        Generating share URL...
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Divider */}
                        {SHOW_COMMUNITY_PUBLISH && (
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="px-4 bg-white dark:bg-gray-900 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">or</span>
                                </div>
                            </div>
                        )}

                        {/* Community Publishing Section */}
                        {SHOW_COMMUNITY_PUBLISH && (
                            <div className="space-y-6">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                                        <MessageCircleIcon size={16} className="text-purple-600 dark:text-purple-400" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-medium text-gray-900 dark:text-gray-100">Publish to Community</h3>
                                        <p className="text-sm text-gray-500 dark:text-gray-400">Make it discoverable by others</p>
                                    </div>
                                </div>
                                
                                <div className="space-y-5">
                                    {/* Assistant Name */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Assistant Name <span className="text-red-500">*</span>
                                        </label>
                                        <Input
                                            placeholder="Enter assistant name"
                                            value={communityData.name}
                                            onChange={(e) => setCommunityData({ ...communityData, name: e.target.value })}
                                            classNames={{
                                                input: "text-sm focus:outline-none !focus:ring-0 !focus:ring-offset-0 !ring-0 !ring-offset-0",
                                                inputWrapper: "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 focus-within:border-gray-300 dark:focus-within:border-gray-500 !focus-within:ring-0 !focus-within:ring-offset-0 !ring-0 !ring-offset-0"
                                            }}
                                        />
                                    </div>

                                    {/* Description */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Description <span className="text-red-500">*</span>
                                        </label>
                                        <Textarea
                                            placeholder="Describe what this assistant does..."
                                            value={communityData.description}
                                            onChange={(e) => setCommunityData({ ...communityData, description: e.target.value })}
                                            minRows={3}
                                            classNames={{
                                                input: "text-sm focus:outline-none !focus:ring-0 !focus:ring-offset-0 !ring-0 !ring-offset-0",
                                                inputWrapper: "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 focus-within:border-gray-300 dark:focus-within:border-gray-500 !focus-within:ring-0 !focus-within:ring-offset-0 !ring-0 !ring-offset-0"
                                            }}
                                        />
                                    </div>

                                    {/* Category */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                            Category <span className="text-red-500">*</span>
                                        </label>
                                        <Select
                                            placeholder="Select a category"
                                            selectedKeys={communityData.category ? [communityData.category] : []}
                                            onSelectionChange={(keys) => {
                                                const selected = Array.from(keys)[0] as string;
                                                setCommunityData({ ...communityData, category: selected });
                                            }}
                                            classNames={{
                                                trigger: "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 focus:outline-none !focus:ring-0 !focus:ring-offset-0 !ring-0 !ring-offset-0 focus-within:border-gray-300 dark:focus-within:border-gray-500 !focus-within:ring-0 !focus-within:ring-offset-0",
                                                value: "text-sm"
                                            }}
                                        >
                                            <SelectItem key="Work Productivity">Work Productivity</SelectItem>
                                            <SelectItem key="Developer Productivity">Developer Productivity</SelectItem>
                                            <SelectItem key="News & Social">News & Social</SelectItem>
                                            <SelectItem key="Customer Support">Customer Support</SelectItem>
                                            <SelectItem key="Education">Education</SelectItem>
                                            <SelectItem key="Entertainment">Entertainment</SelectItem>
                                            <SelectItem key="Other">Other</SelectItem>
                                        </Select>
                                    </div>

                                    {/* Privacy Toggle */}
                                    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/30 rounded-xl border border-gray-200 dark:border-gray-700">
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                                                {communityData.isAnonymous ? 'Publish anonymously' : `Publish as ${getUserDisplayName()}`}
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                {communityData.isAnonymous ? 'Your name will be hidden from the community' : 'Your name will be visible to the community'}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setCommunityData({ ...communityData, isAnonymous: !communityData.isAnonymous })}
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                                                communityData.isAnonymous ? 'bg-gray-300 dark:bg-gray-600' : 'bg-blue-600'
                                            }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                    communityData.isAnonymous ? 'translate-x-1' : 'translate-x-6'
                                                }`}
                                            />
                                        </button>
                                    </div>

                                    {/* Success Message */}
                                    {communityPublishSuccess && (
                                        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                                            <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                                                <span className="text-green-600 dark:text-green-400 text-xs">✓</span>
                                            </div>
                                            <p className="text-green-700 dark:text-green-300 text-sm font-medium">
                                                Successfully published to community!
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </ModalBody>
                <ModalFooter className="gap-3">
                    <Button 
                        variant="light" 
                        onPress={onShareModalClose}
                        className="px-6 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    >
                        Close
                    </Button>
                    {SHOW_COMMUNITY_PUBLISH && (
                        <Button
                            color={communityPublishSuccess ? "success" : "primary"}
                            onPress={() => {
                                // Open confirmation first
                                onConfirmOpen();
                            }}
                            isLoading={communityPublishing}
                            isDisabled={communityPublishSuccess || !communityData.name.trim() || !communityData.description.trim() || !communityData.category}
                            className={`${communityPublishSuccess ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'} px-6 py-2 text-white font-medium`}
                        >
                            {communityPublishSuccess ? 'Published' : (communityPublishing ? 'Publishing...' : 'Publish to Community')}
                        </Button>
                    )}
                </ModalFooter>
            </ModalContent>
        </Modal>

        {/* Confirmation Modal for Community Publish */}
        {SHOW_COMMUNITY_PUBLISH && (
            <Modal 
                isOpen={isConfirmOpen} 
                onClose={() => { setAcknowledged(false); onConfirmClose(); }}
                size="md"
                classNames={{
                    base: "bg-white dark:bg-gray-900",
                    header: "border-b border-gray-200 dark:border-gray-700 pb-3",
                    body: "py-5",
                    footer: "border-t border-gray-200 dark:border-gray-700 pt-3"
                }}
            >
                <ModalContent>
                    <ModalHeader>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Confirm publish to community</h3>
                    </ModalHeader>
                    <ModalBody>
                        <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                            <p>Publishing to community will make this assistant and its description publicly visible to other users.</p>
                            <ul className="list-disc pl-5 space-y-1">
                                <li>Your assistant may appear in the community templates library.</li>
                                <li>Others can import and use this assistant in their own projects.</li>
                                <li>Do not include secrets or private data in the description or workflow.</li>
                            </ul>
                            <div className="mt-3 flex items-start gap-2">
                                <input
                                    id="ack-publish"
                                    type="checkbox"
                                    checked={acknowledged}
                                    onChange={(e) => setAcknowledged(e.target.checked)}
                                    className="mt-1 h-4 w-4"
                                />
                                <label htmlFor="ack-publish" className="text-sm">I understand this will be publicly available.</label>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="light" onPress={() => { setAcknowledged(false); onConfirmClose(); }}>Cancel</Button>
                        <Button
                            color="primary"
                            isDisabled={!acknowledged}
                            onPress={() => {
                                onConfirmClose();
                                setAcknowledged(false);
                                onCommunityPublish();
                            }}
                        >
                            Confirm & Publish
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        )}
        </>
    );
}
