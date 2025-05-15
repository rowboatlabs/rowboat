"use client";
import { WorkflowTool } from "../../../lib/types/workflow_types";
import { Checkbox, Select, SelectItem, RadioGroup, Radio } from "@heroui/react";
import { z } from "zod";
import { ImportIcon, XIcon, PlusIcon, FolderIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/common/panel-common";
import { Button } from "@/components/ui/button";
import clsx from "clsx";

// Update textarea styles with improved states
const textareaStyles = "rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500";

// Add divider styles
const dividerStyles = "border-t border-gray-200 dark:border-gray-800";

// Common section header styles
const sectionHeaderStyles = "text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

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
                    <Textarea
                        value={localName}
                        onChange={(e) => setLocalName(e.target.value)}
                        onBlur={() => {
                            if (localName && localName !== param.name) {
                                handleRename(param.name, localName);
                            }
                        }}
                        placeholder="Enter parameter name..."
                        disabled={readOnly}
                        className={textareaStyles}
                        autoResize
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

    const [selectedParams, setSelectedParams] = useState(new Set([]));
    const isReadOnly = tool.isMcp || tool.isLibrary;
    const [nameError, setNameError] = useState<string | null>(null);

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
    }

    function validateToolName(value: string) {
        if (value.length === 0) {
            return "Name cannot be empty";
        }
        return null;
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
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {tool.name}
                        </div>
                        {tool.isMcp && (
                            <div className="flex items-center gap-2 text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full text-gray-700 dark:text-gray-300">
                                <ImportIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                                <span className="text-xs">MCP: {tool.mcpServerName}</span>
                            </div>
                        )}
                        {tool.isLibrary && (
                            <div className="flex items-center gap-2 text-sm bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full text-gray-700 dark:text-gray-300">
                                <FolderIcon className="w-4 h-4 text-blue-700 dark:text-blue-400" />
                                <span className="text-xs">Library Tool</span>
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
            <div className="flex flex-col gap-6 p-4">
                {!isReadOnly && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className={sectionHeaderStyles}>
                                Name
                            </label>
                            <div className={clsx(
                                "border rounded-lg focus-within:ring-2",
                                nameError 
                                    ? "border-red-500 focus-within:ring-red-500/20" 
                                    : "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                            )}>
                                <Textarea
                                    value={tool.name}
                                    useValidation={true}
                                    updateOnBlur={true}
                                    validate={(value) => {
                                        const error = validateToolName(value);
                                        setNameError(error);
                                        return { valid: !error, errorMessage: error || undefined };
                                    }}
                                    onValidatedChange={(value) => {
                                        handleUpdate({
                                            ...tool,
                                            name: value
                                        });
                                    }}
                                    placeholder="Enter tool name..."
                                    className="w-full text-sm bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                                    autoResize
                                />
                            </div>
                            {nameError && (
                                <p className="text-sm text-red-500">{nameError}</p>
                            )}
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="space-y-2">
                        <label className={sectionHeaderStyles}>
                            Description
                        </label>
                        <Textarea
                            value={tool.description}
                            onChange={(e) => handleUpdate({
                                ...tool,
                                description: e.target.value
                            })}
                            placeholder="Describe what this tool does..."
                            disabled={isReadOnly}
                            className={textareaStyles}
                            autoResize
                        />
                    </div>
                </div>

                {!isReadOnly && (
                    <div className="space-y-4">
                        <label className={sectionHeaderStyles}>
                            Tool Mode
                        </label>
                        
                        <RadioGroup
                            defaultValue="mock"
                            value={tool.mockTool ? "mock" : "api"}
                            onValueChange={(value) => handleUpdate({
                                ...tool,
                                mockTool: value === "mock",
                                autoSubmitMockedResponse: value === "mock" ? true : undefined
                            })}
                            orientation="horizontal"
                            classNames={{
                                wrapper: "flex gap-12 pl-3",
                                label: "text-sm"
                            }}
                        >
                            <Radio 
                                value="mock"
                                classNames={{
                                    base: "p-0 data-[selected=true]:bg-indigo-50 dark:data-[selected=true]:bg-indigo-950/50 rounded-lg transition-colors",
                                    label: "text-base font-normal text-gray-900 dark:text-gray-100 px-3 py-1"
                                }}
                            >
                                Mock tool responses
                            </Radio>
                            <Radio 
                                value="api"
                                classNames={{
                                    base: "p-0 data-[selected=true]:bg-indigo-50 dark:data-[selected=true]:bg-indigo-900/50 rounded-lg transition-colors",
                                    label: "text-base font-normal text-gray-900 dark:text-gray-100 px-3 py-1"
                                }}
                            >
                                Connect tool to your API
                            </Radio>
                        </RadioGroup>
                    </div>
                )}

                {tool.mockTool && (
                    <div className={`space-y-4 ${dividerStyles} pt-6`}>
                        <div className="space-y-4">
                            <label className={sectionHeaderStyles}>
                                Mock Settings
                            </label>
                            <div className="pl-3 space-y-4">
                                <Checkbox
                                    size="sm"
                                    isSelected={tool.autoSubmitMockedResponse ?? true}
                                    onValueChange={(value) => handleUpdate({
                                        ...tool,
                                        autoSubmitMockedResponse: value
                                    })}
                                >
                                    <span className="text-sm text-gray-600 dark:text-gray-300">
                                        Automatically send mock response in chat
                                    </span>
                                </Checkbox>

                                <Textarea
                                    value={tool.mockInstructions || ''}
                                    onChange={(e) => handleUpdate({
                                        ...tool,
                                        mockInstructions: e.target.value
                                    })}
                                    placeholder="Describe the response the mock tool should return..."
                                    className={textareaStyles}
                                    autoResize
                                />
                            </div>
                        </div>
                    </div>
                )}

                <div className={`space-y-4 ${dividerStyles} pt-6`}>
                    <label className={sectionHeaderStyles}>
                        Parameters
                    </label>
                    <div className="pl-3 space-y-3">
                        {renderParameters()}
                    </div>

                    {!isReadOnly && (
                        <div className="pl-3">
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
                                }}
                                className="hover:bg-indigo-100 dark:hover:bg-indigo-900 hover:shadow-indigo-500/20 dark:hover:shadow-indigo-400/20 hover:shadow-lg transition-all"
                            >
                                Add Parameter
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </Panel>
    );
}