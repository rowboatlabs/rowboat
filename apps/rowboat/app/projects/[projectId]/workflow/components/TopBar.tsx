"use client";
import React from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip, Input } from "@heroui/react";
import { RadioIcon, RedoIcon, UndoIcon, RocketIcon, PenLine, AlertTriangle, DownloadIcon, SettingsIcon, ChevronDownIcon, ZapIcon } from "lucide-react";

interface TopBarProps {
    localProjectName: string;
    projectNameError: string | null;
    onProjectNameChange: (value: string) => void;
    publishing: boolean;
    isLive: boolean;
    showCopySuccess: boolean;
    canUndo: boolean;
    canRedo: boolean;
    showCopilot: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onDownloadJSON: () => void;
    onPublishWorkflow: () => void;
    onChangeMode: (mode: 'draft' | 'live') => void;
    onRevertToLive: () => void;
    onToggleCopilot: () => void;
    onSettingsModalOpen: () => void;
    onTriggersModalOpen: () => void;
}

export function TopBar({
    localProjectName,
    projectNameError,
    onProjectNameChange,
    publishing,
    isLive,
    showCopySuccess,
    canUndo,
    canRedo,
    showCopilot,
    onUndo,
    onRedo,
    onDownloadJSON,
    onPublishWorkflow,
    onChangeMode,
    onRevertToLive,
    onToggleCopilot,
    onSettingsModalOpen,
    onTriggersModalOpen,
}: TopBarProps) {
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
                            isInvalid={!!projectNameError}
                            errorMessage={projectNameError}
                            placeholder="Project name..."
                            variant="bordered"
                            size="sm"
                            classNames={{
                                base: "max-w-xs",
                                input: "text-base font-semibold px-2",
                                inputWrapper: "min-h-[28px] h-[28px] border-gray-200 dark:border-gray-700 px-0"
                            }}
                        />
                    </div>
                    
                    <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>
                    
                    <div className="flex items-center gap-2">
                        {publishing && <Spinner size="sm" />}
                        {isLive && <div className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5">
                            <RadioIcon size={16} />
                            Live workflow
                        </div>}
                        {!isLive && <div className="bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1.5">
                            <PenLine size={16} />
                            Draft workflow
                        </div>}

                        {/* Download JSON icon button, with tooltip, to the left of the menu */}
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
                </div>
                {showCopySuccess && <div className="flex items-center gap-2">
                    <div className="text-green-500">Copied to clipboard</div>
                </div>}
                <div className="flex items-center gap-2">
                    {isLive && <div className="flex items-center gap-2">
                        <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2">
                            <AlertTriangle size={16} />
                            This version is locked. Changes applied will not be reflected.
                        </div>
                    </div>}
                    
                    {!isLive && <>
                        <button
                            className="p-1 text-gray-400 hover:text-black hover:cursor-pointer"
                            title="Undo"
                            disabled={!canUndo}
                            onClick={onUndo}
                        >
                            <UndoIcon size={16} />
                        </button>
                        <button
                            className="p-1 text-gray-400 hover:text-black hover:cursor-pointer"
                            title="Redo"
                            disabled={!canRedo}
                            onClick={onRedo}
                        >
                            <RedoIcon size={16} />
                        </button>
                    </>}
                    
                    {/* Deploy CTA - always visible */}
                    <div className="flex">
                        <Button
                            variant="solid"
                            size="md"
                            onPress={onPublishWorkflow}
                            className="gap-2 px-4 bg-green-600 hover:bg-green-700 text-white font-semibold text-sm rounded-r-none"
                            startContent={<RocketIcon size={16} />}
                            data-tour-target="deploy"
                        >
                            Deploy
                        </Button>
                        <Dropdown>
                            <DropdownTrigger>
                                <Button
                                    variant="solid"
                                    size="md"
                                    className="min-w-0 px-2 bg-green-600 hover:bg-green-700 border-l-1 border-green-500 text-white font-semibold text-sm rounded-l-none"
                                >
                                    <ChevronDownIcon size={14} />
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu aria-label="Deploy actions">
                                <DropdownItem
                                    key="settings"
                                    startContent={<SettingsIcon size={16} />}
                                    onPress={onSettingsModalOpen}
                                >
                                    API & SDK settings
                                </DropdownItem>
                                <DropdownItem
                                    key="manage-triggers"
                                    startContent={<ZapIcon size={16} />}
                                    onPress={onTriggersModalOpen}
                                >
                                    Manage triggers
                                </DropdownItem>
                                {!isLive ? (
                                    <>
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
                                    </>
                                ) : null}
                            </DropdownMenu>
                        </Dropdown>
                    </div>
                    
                    {isLive && <div className="flex items-center gap-2">
                        <Button
                            variant="solid"
                            size="md"
                            onPress={() => onChangeMode('draft')}
                            className="gap-2 px-4 bg-gray-600 hover:bg-gray-700 text-white font-semibold text-sm"
                        >
                            Switch to draft
                        </Button>
                    </div>}
                    
                    {!isLive && <Button
                        variant="solid"
                        size="md"
                        onPress={onToggleCopilot}
                        className="gap-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm"
                        startContent={showCopilot ? null : <span className="text-indigo-300">✨</span>}
                    >
                        {showCopilot ? "Hide Skipper" : "Skipper"}
                    </Button>}
                </div>
            </div>
        </div>
    );
}
