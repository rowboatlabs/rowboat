"use client";
import { WorkflowTool } from "../../../lib/types/workflow_types";
import { Checkbox, Select, SelectItem, Switch } from "@heroui/react";
import { z } from "zod";
import { ImportIcon, XIcon, PlusIcon, FolderIcon, Globe, Zap, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { SectionCard } from "@/components/common/section-card";
import { ToolParamCard } from "@/components/common/tool-param-card";
import { UserIcon, Settings, Settings2 } from "lucide-react";
import { InputField } from "@/app/lib/components/input-field";
import Link from "next/link";
import { Tooltip } from "@heroui/react";

// Update textarea styles with improved states
const textareaStyles = "rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500";

// Add divider styles
const dividerStyles = "border-t border-gray-200 dark:border-gray-800";

// Common section header styles
const sectionHeaderStyles = "block text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

export function ParameterConfig({
    param,
    handleUpdate,
    handleDelete,
    handleRename,
    readOnly
}: {
    param: {
        name: string,
        description: string,
        type: string,
        required: boolean
    },
    handleUpdate: (name: string, data: {
        description: string,
        type: string,
        required: boolean
    }) => void,
    handleDelete: (name: string) => void,
    handleRename: (oldName: string, newName: string) => void,
    readOnly?: boolean
}) {
    const [localName, setLocalName] = useState(param.name);

    useEffect(() => {
        setLocalName(param.name);
    }, [param.name]);

    return (
        <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {param.name}
                </div>
                {!readOnly && (
                    <Button
                        variant="tertiary"
                        size="sm"
                        onClick={() => handleDelete(param.name)}
                        startContent={<XIcon className="w-4 h-4" />}
                        aria-label={`Remove parameter ${param.name}`}
                    >
                        Remove
                    </Button>
                )}
            </div>

            <div className="space-y-4">
                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Name
                    </label>
                    <InputField
                        type="text"
                        value={localName}
                        onChange={(value: string) => setLocalName(value)}
                        placeholder="Enter parameter name..."
                        locked={readOnly}
                        className="w-full"
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Description
                    </label>
                    <Textarea
                        value={param.description}
                        onChange={(e) => {
                            handleUpdate(param.name, {
                                ...param,
                                description: e.target.value
                            });
                        }}
                        placeholder="Describe this parameter..."
                        disabled={readOnly}
                        className={textareaStyles}
                        autoResize
                    />
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Type
                    </label>
                    <Select
                        variant="bordered"
                        className="w-52"
                        size="sm"
                        selectedKeys={new Set([param.type])}
                        onSelectionChange={(keys) => {
                            handleUpdate(param.name, {
                                ...param,
                                type: Array.from(keys)[0] as string
                            });
                        }}
                        isDisabled={readOnly}
                    >
                        {['string', 'number', 'boolean', 'array', 'object'].map(type => (
                            <SelectItem key={type}>
                                {type}
                            </SelectItem>
                        ))}
                    </Select>
                </div>

                <Checkbox
                    size="sm"
                    isSelected={param.required}
                    onValueChange={() => {
                        handleUpdate(param.name, {
                            ...param,
                            required: !param.required
                        });
                    }}
                    isDisabled={readOnly}
                >
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                        Required parameter
                    </span>
                </Checkbox>
            </div>
        </div>
    );
}

export function ToolConfig({
    tool,
    usedToolNames,
    handleUpdate,
    handleClose
}: {
    tool: z.infer<typeof WorkflowTool>,
    usedToolNames: Set<string>,
    handleUpdate: (tool: z.infer<typeof WorkflowTool>) => void,
    handleClose: () => void
}) {
    console.log('[ToolConfig] Received tool data:', {
        name: tool.name,
        isMcp: tool.isMcp,
        fullTool: tool,
        parameters: tool.parameters,
        parameterKeys: tool.parameters ? Object.keys(tool.parameters.properties) : [],
        required: tool.parameters?.required || []
    });

    const params = useParams();
    const projectId = params.projectId as string;
    const [selectedParams, setSelectedParams] = useState(new Set([]));
    const isReadOnly = tool.isMcp || tool.isComposio;
    const [nameError, setNameError] = useState<string | null>(null);
    const [showSavedBanner, setShowSavedBanner] = useState(false);
    const [localToolName, setLocalToolName] = useState(tool.name);

    // Function to show saved banner
    const showSavedMessage = () => {
        setShowSavedBanner(true);
        setTimeout(() => setShowSavedBanner(false), 2000);
    };

    useEffect(() => {
        setLocalToolName(tool.name);
    }, [tool.name]);

    // Log when parameters are being rendered
    useEffect(() => {
        console.log('[ToolConfig] Processing parameters for render:', {
            toolName: tool.name,
            hasParameters: !!tool.parameters,
            parameterDetails: tool.parameters ? {
                type: tool.parameters.type,
                propertyCount: Object.keys(tool.parameters.properties).length,
                properties: Object.entries(tool.parameters.properties).map(([name, param]) => ({
                    name,
                    type: param.type,
                    description: param.description,
                    isRequired: tool.parameters?.required?.includes(name)
                })),
                required: tool.parameters.required
            } : null
        });
    }, [tool.name, tool.parameters]);

    function handleParamRename(oldName: string, newName: string) {
        const newProperties = { ...tool.parameters!.properties };
        newProperties[newName] = newProperties[oldName];
        delete newProperties[oldName];

        const newRequired = [...(tool.parameters?.required || [])];
        newRequired.splice(newRequired.indexOf(oldName), 1);
        newRequired.push(newName);

        handleUpdate({
            ...tool,
            parameters: { ...tool.parameters!, properties: newProperties, required: newRequired }
        });
        showSavedMessage();
    }

    function handleParamUpdate(name: string, data: {
        description: string,
        type: string,
        required: boolean
    }) {
        const newProperties = { ...tool.parameters!.properties };
        newProperties[name] = {
            type: data.type,
            description: data.description
        };

        const newRequired = [...(tool.parameters?.required || [])];
        if (data.required && !newRequired.includes(name)) {
            newRequired.push(name);
        } else if (!data.required) {
            newRequired.splice(newRequired.indexOf(name), 1);
        }

        handleUpdate({
            ...tool,
            parameters: {
                ...tool.parameters!,
                properties: newProperties,
                required: newRequired,
            }
        });
        showSavedMessage();
    }

    function handleParamDelete(paramName: string) {
        const newProperties = { ...tool.parameters!.properties };
        delete newProperties[paramName];

        const newRequired = [...(tool.parameters?.required || [])];
        newRequired.splice(newRequired.indexOf(paramName), 1);

        handleUpdate({
            ...tool,
            parameters: {
                ...tool.parameters!,
                properties: newProperties,
                required: newRequired,
            }
        });
        showSavedMessage();
    }

    function validateToolName(value: string) {
        if (value.length === 0) {
            setNameError("Name cannot be empty");
            return false;
        }
        if (value !== tool.name && usedToolNames.has(value)) {
            setNameError("This name is already taken");
            return false;
        }
        setNameError(null);
        return true;
    }

    // Log parameter rendering in the actual parameter section
    const renderParameters = () => {
        if (!tool.parameters?.properties) {
            console.log('[ToolConfig] No parameters to render');
            return null;
        }

        console.log('[ToolConfig] Rendering parameters:', {
            count: Object.keys(tool.parameters.properties).length,
            parameters: Object.keys(tool.parameters.properties)
        });

        return Object.entries(tool.parameters.properties).map(([paramName, param], index) => {
            console.log('[ToolConfig] Rendering parameter:', {
                name: paramName,
                param,
                isRequired: tool.parameters?.required?.includes(paramName)
            });

            return (
                <ParameterConfig
                    key={paramName}
                    param={{
                        name: paramName,
                        description: param.description,
                        type: param.type,
                        required: tool.parameters?.required?.includes(paramName) ?? false
                    }}
                    handleUpdate={handleParamUpdate}
                    handleDelete={handleParamDelete}
                    handleRename={handleParamRename}
                    readOnly={isReadOnly}
                />
            );
        });
    };

    return (
        <Panel
            title={
                <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            {tool.name}
                        </div>
                        {tool.isMcp && (
                            <div className="flex items-center gap-2 text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full text-gray-700 dark:text-gray-300">
                                <ImportIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                                <span>MCP: {tool.mcpServerName}</span>
                            </div>
                        )}
                        {tool.isLibrary && (
                            <div className="flex items-center gap-2 text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full text-gray-700 dark:text-gray-300">
                                <FolderIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                                <span>Library Tool</span>
                            </div>
                        )}
                    </div>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleClose}
                        showHoverContent={true}
                        hoverContent="Close"
                    >
                        <XIcon className="w-4 h-4" />
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-4 pb-4 pt-4 p-4">
                {/* Saved Banner */}
                {showSavedBanner && (
                    <div className="absolute top-4 left-4 z-10 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in slide-in-from-top-2 duration-300">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm font-medium">Changes saved ✓</span>
                    </div>
                )}

                {/* Identity Section */}
                <SectionCard
                    icon={<UserIcon className="w-5 h-5 text-indigo-500" />}
                    title="Identity"
                    labelWidth="md:w-32"
                    className="mb-1"
                >
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                            <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Name</label>
                            <div className="flex-1">
                                <InputField
                                    type="text"
                                    value={localToolName}
                                    locked={isReadOnly}
                                    onChange={(value: string) => {
                                        setLocalToolName(value);
                                        if (validateToolName(value)) {
                                            handleUpdate({
                                                ...tool,
                                                name: value
                                            });
                                        }
                                        showSavedMessage();
                                    }}


                                    error={nameError}
                                    className="w-full"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col md:flex-row md:items-start gap-1 md:gap-0">
                            <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 md:w-32 mb-1 md:mb-0 md:pr-4">Description</label>
                            <div className="flex-1">
                                <InputField
                                    type="text"
                                    locked={isReadOnly}
                                    value={tool.description || ""}
                                    onChange={(value: string) => {
                                        handleUpdate({ ...tool, description: value });
                                        showSavedMessage();
                                    }}
                                    multiline={true}
                                    placeholder="Describe what this tool does..."
                                    className="w-full"
                                />
                            </div>
                        </div>
                    </div>
                </SectionCard>
                {/* Mock Section */}
                <SectionCard
                    icon={<Settings className="w-5 h-5 text-indigo-500" />}
                    title={<span className="whitespace-nowrap">Mock responses</span>}
                    labelWidth="md:w-32"
                    className="mb-1"
                    singleColumnFields={true}
                >
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Mock tool responses</label>
                            <div className="flex items-center gap-2 mb-1">
                                <Switch
                                    isSelected={tool.mockTool}
                                    onValueChange={(value) => {
                                        handleUpdate({
                                            ...tool,
                                            mockTool: value,
                                        });
                                        showSavedMessage();
                                    }}
                                    size="sm"
                                    color="primary"
                                />
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    When enabled, this tool will be mocked.
                                </span>
                            </div>
                        </div>
                        {tool.mockTool && (
                            <div className="flex flex-col gap-1 mt-4">
                                <label className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Mock Response Instructions</label>
                                <span className="text-xs text-gray-500 dark:text-gray-400 mb-1">Describe the response the mock tool should return. This will be shown in the chat when the tool is called.</span>
                                <InputField
                                    type="text"
                                    value={tool.mockInstructions || ''}
                                    onChange={(value: string) => {
                                        handleUpdate({
                                            ...tool,
                                            mockInstructions: value
                                        });
                                        showSavedMessage();
                                    }}
                                    multiline={true}
                                    placeholder="Mock response instructions..."
                                    className="w-full text-xs p-2 bg-white dark:bg-gray-900"
                                />
                            </div>
                        )}
                    </div>
                </SectionCard>
                {/* Parameters Section */}
                <SectionCard
                    icon={<Settings2 className="w-5 h-5 text-indigo-500" />}
                    title="Parameters"
                    labelWidth="md:w-32"
                    className="mb-1"
                >
                    <div className="flex flex-col gap-2">
                        {tool.parameters?.properties && Object.entries(tool.parameters.properties).map(([paramName, param]) => (
                            <ToolParamCard
                                key={paramName}
                                param={{
                                    name: paramName,
                                    description: param.description,
                                    type: param.type,
                                    required: tool.parameters?.required?.includes(paramName) ?? false
                                }}
                                handleUpdate={handleParamUpdate}
                                handleDelete={handleParamDelete}
                                handleRename={handleParamRename}
                                readOnly={isReadOnly}
                            />
                        ))}
                        {!isReadOnly && (
                            <Button
                                variant="primary"
                                size="sm"
                                startContent={<PlusIcon className="w-4 h-4" />}
                                onClick={() => {
                                    const newParamName = `param${Object.keys(tool.parameters?.properties || {}).length + 1}`;
                                    const newProperties = {
                                        ...(tool.parameters?.properties || {}),
                                        [newParamName]: {
                                            type: 'string',
                                            description: ''
                                        }
                                    };
                                    handleUpdate({
                                        ...tool,
                                        parameters: {
                                            type: 'object',
                                            properties: newProperties,
                                            required: [...(tool.parameters?.required || []), newParamName]
                                        }
                                    });
                                    showSavedMessage();
                                }}
                                className="hover:bg-indigo-100 dark:hover:bg-indigo-900 hover:shadow-indigo-500/20 dark:hover:shadow-indigo-400/20 hover:shadow-lg transition-all mt-2"
                            >
                                Add Parameter
                            </Button>
                        )}
                    </div>
                </SectionCard>
            </div>
        </Panel>
    );
}