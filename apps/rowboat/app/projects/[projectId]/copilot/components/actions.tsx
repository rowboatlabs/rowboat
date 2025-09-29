'use client';
import { createContext, useContext, useRef, useState, useEffect } from "react";
import clsx from "clsx";
import { z } from "zod";
import { CopilotAssistantMessageActionPart } from "../../../../../src/entities/models/copilot";
import { Workflow } from "../../../../lib/types/workflow_types";
import { PreviewModalProvider, usePreviewModal } from '../../workflow/preview-modal';
import { getAppliedChangeKey } from "../app";
import { AlertTriangleIcon, CheckCheckIcon, CheckIcon, ChevronsDownIcon, ChevronsUpIcon, EyeIcon, PencilIcon, PlusIcon } from "lucide-react";
import { Spinner } from "@heroui/react";
import { PictureImg } from "@/components/ui/picture-img";

const ActionContext = createContext<{
    msgIndex: number;
    actionIndex: number;
    action: z.infer<typeof CopilotAssistantMessageActionPart>['content'] | null;
    workflow: z.infer<typeof Workflow> | null;
    appliedFields: string[];
    stale: boolean;
}>({ msgIndex: 0, actionIndex: 0, action: null, workflow: null, appliedFields: [], stale: false });

export function Action({
    msgIndex,
    actionIndex,
    action,
    workflow,
    dispatch,
    stale,
    onApplied,
    externallyApplied = false,
    defaultExpanded = false,
}: {
    msgIndex: number;
    actionIndex: number;
    action: z.infer<typeof CopilotAssistantMessageActionPart>['content'];
    workflow: z.infer<typeof Workflow>;
    dispatch: (action: any) => void;
    stale: boolean;
    onApplied?: () => void;
    externallyApplied?: boolean;
    defaultExpanded?: boolean;
}) {
    const { showPreview } = usePreviewModal();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [appliedChanges, setAppliedChanges] = useState<Record<string, boolean>>({});

    if (!action || typeof action !== 'object') {
        console.warn('Invalid action object:', action);
        return null;
    }

    const appliedFields = Object.keys(action.config_changes).filter(key => 
        appliedChanges[getAppliedChangeKey(msgIndex, actionIndex, key)]
    );
    let allApplied = externallyApplied || Object.keys(action.config_changes).every(key =>
        appliedFields.includes(key)
    );
    if (!externallyApplied && (action.action === "delete" || action.config_type === 'start_agent')) {
        allApplied = false;
    }

    // Handle applying a single field change
    const handleFieldChange = (field: string) => {
        const changes = { [field]: action.config_changes[field] };
        
        // Dispatch the field change directly (this is for partial updates)
        switch (action.config_type) {
            case 'agent':
                dispatch({
                    type: 'update_agent_no_select',
                    name: action.name,
                    agent: changes
                });
                break;
            case 'tool':
                dispatch({
                    type: 'update_tool_no_select',
                    name: action.name,
                    tool: changes
                });
                break;
            case 'prompt':
                dispatch({
                    type: 'update_prompt',
                    name: action.name,
                    prompt: changes
                });
                break;
        }

        setAppliedChanges(prev => {
            const newApplied = {
                ...prev,
                [getAppliedChangeKey(msgIndex, actionIndex, field)]: true
            };
            
            // Check if all fields are now applied
            const allFieldsApplied = Object.keys(action.config_changes).every(key => 
                newApplied[getAppliedChangeKey(msgIndex, actionIndex, key)]
            );
            
            // If all fields are applied, mark as externally applied but don't call onApplied
            // to avoid duplicate dispatch (the parent's onApplied would dispatch the full action again)
            
            return newApplied;
        });
    };

    // Handle applying all changes - delegate to parent
    const handleApplyAll = () => {
        // Mark all fields as applied locally for UI state
        const appliedKeys = Object.keys(action.config_changes).reduce((acc, key) => {
            acc[getAppliedChangeKey(msgIndex, actionIndex, key)] = true;
            return acc;
        }, {} as Record<string, boolean>);
        setAppliedChanges(prev => ({
            ...prev,
            ...appliedKeys
        }));

        // Notify parent to handle the actual dispatching
        onApplied?.();
    };

    // Helper to get the main field for diff
    function getMainDiffField() {
        if (action.config_type === 'agent' && 'instructions' in action.config_changes) return 'instructions';
        if (action.config_type === 'tool' && 'description' in action.config_changes) return 'description';
        if (action.config_type === 'prompt' && 'prompt' in action.config_changes) return 'prompt';
        // fallback: first field
        return Object.keys(action.config_changes)[0];
    }

    function handleViewDiff() {
        const field = getMainDiffField();
        if (!field) return;
        const newValue = action.config_changes[field];
        let oldValue = undefined;
        if (action.action === 'edit') {
            if (action.config_type === 'tool') {
                const tool = workflow.tools.find(t => t.name === action.name);
                if (tool) oldValue = (tool as any)[field];
            } else if (action.config_type === 'agent') {
                const agent = workflow.agents.find(a => a.name === action.name);
                if (agent) oldValue = (agent as any)[field];
            } else if (action.config_type === 'prompt') {
                const prompt = workflow.prompts.find(p => p.name === action.name);
                if (prompt) oldValue = (prompt as any)[field];
            }
        }
        const markdown = (action.config_type === 'agent' && field === 'instructions') ||
            (action.config_type === 'prompt' && field === 'prompt');
        showPreview(
            oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue, null, 2)) : undefined,
            typeof newValue === 'string' ? newValue : JSON.stringify(newValue, null, 2),
            markdown,
            `${action.name} - ${field}`,
            'Review changes'
        );
    }

    // Determine composio toolkit logo for tools
    const toolkitLogo = (() => {
        if (action.config_type !== 'tool') return undefined;
        const getLogo = (o: any): string | undefined => {
            return (
                o?.composioData?.logo ||
                o?.composioData?.logoUrl ||
                o?.composio?.logo ||
                o?.toolkit?.logo ||
                o?.composio_tool?.toolkit?.logo ||
                o?.logo ||
                undefined
            );
        };
        // Try various shapes the action might use
        const a: any = action as any;
        return (
            getLogo(a.config_changes) ||
            getLogo(a) ||
            getLogo(a.config_changes?.tool) ||
            getLogo(a.config_changes?.composio_tool) ||
            getLogo(a.tool) ||
            (workflow.tools.find(t => t.name === action.name) as any)?.composioData?.logo ||
            undefined
        );
    })();

    return <div className={clsx(
        'flex flex-col rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xs',
        'transition-shadow duration-150',
        {
            'border-l-2 border-l-blue-500': !stale && !allApplied && action.action == 'create_new',
            'border-l-2 border-l-yellow-500': !stale && !allApplied && action.action == 'edit',
            'border-l-2 border-l-red-500': !stale && !allApplied && action.action == 'delete',
            'border-l-2 border-l-gray-400': stale || allApplied || action.error,
        }
    )}>
        <ActionContext.Provider value={{ msgIndex, actionIndex, action, workflow, appliedFields, stale }}>
            <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-100 dark:border-zinc-800">
                {/* Small colored icon for type; show composio toolkit logo for tools when available */}
                <span className={clsx(
                    'inline-flex items-center justify-center rounded-full h-5 w-5 text-xs overflow-hidden',
                    {
                        'bg-blue-100 text-blue-600': action.action == 'create_new',
                        'bg-yellow-100 text-yellow-600': action.action == 'edit',
                        'bg-red-100 text-red-600': action.action == 'delete',
                        'bg-gray-200 text-gray-600': stale || allApplied || action.error,
                    }
                )}>
                    {action.config_type === 'tool' && toolkitLogo ? (
                        <PictureImg src={toolkitLogo} alt={"Toolkit logo"} className="h-5 w-5 object-contain" />
                    ) : (
                        action.config_type === 'agent' ? '🧑‍💼' : action.config_type === 'tool' ? '🛠️' : action.config_type === 'pipeline' ? '⚙️' : action.config_type === 'start_agent' ? '🏁' : action.config_type === 'prompt' ? '💬' : action.config_type === 'one_time_trigger' ? '⏰' : action.config_type === 'recurring_trigger' ? '🔄' : action.config_type === 'external_trigger' ? '🔗' : '💬'
                    )}
                </span>
                <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-100 truncate flex-1">
                    {action.action === 'create_new' ? 'Add' : action.action === 'edit' ? 'Edit' : 'Delete'} {action.config_type}: {action.name}
                </span>
                {/* Action buttons - compact, icon only, show text on hover */}
                <div className="flex items-center gap-1">
                    <button
                        className={clsx(
                            'flex items-center gap-1 rounded-full px-2 h-7 text-xs font-medium transition-colors bg-transparent',
                            allApplied
                                ? 'text-zinc-400 cursor-not-allowed'
                                : 'text-green-600 hover:text-green-700'
                        )}
                        disabled={allApplied}
                        onClick={() => handleApplyAll()}
                    >
                        <CheckIcon size={13} className={allApplied ? 'text-zinc-400' : 'text-green-600 group-hover:text-green-700'} />
                        <span>{allApplied ? 'Applied' : 'Apply'}</span>
                    </button>
                    {action.action !== 'delete' && <button
                        className="flex items-center gap-1 rounded-full px-2 h-7 text-xs font-medium bg-transparent text-indigo-600 hover:text-indigo-700 transition-colors"
                        onClick={handleViewDiff}
                    >
                        <EyeIcon size={13} className="text-indigo-600 group-hover:text-indigo-700" />
                        <span>View Diff</span>
                    </button>}
                </div>
            </div>
            {/* Description of what happened */}
            <div className="px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200">
                {action.change_description || 'No description provided.'}
            </div>
        </ActionContext.Provider>
    </div>;
}

export function ActionSummary() {
    const { msgIndex, actionIndex, action, workflow, appliedFields, stale } = useContext(ActionContext);
    if (!action || !workflow) return null;

    return <div className="px-1 my-1">
        <div className="bg-white dark:bg-gray-800 rounded-sm p-2 text-sm">
            {action.change_description}
        </div>
    </div>;
}

export function ActionHeader() {
    const { msgIndex, actionIndex, action, workflow, appliedFields, stale } = useContext(ActionContext);
    if (!action || !workflow) return null;

    const targetType = action.config_type === 'tool' ? 'tool' : action.config_type === 'agent' ? 'agent' : action.config_type === 'pipeline' ? 'pipeline' : 'prompt';
    const change = action.action === 'create_new' ? 'Create' : 'Edit';

    return <div className="flex gap-2 items-center py-1 px-1">
        {action.action == 'create_new' && <PlusIcon size={16} />}
        {action.action == 'edit' && <PencilIcon size={16} />}
        <div className="text-sm truncate">{`${change} ${targetType}`}: <span className="font-medium">{action.name}</span></div>
    </div>;
}

export function ActionField({
    field,
    onApply,
}: {
    field: string;
    onApply: (field: string) => void;
}) {
    const { msgIndex, actionIndex, action, workflow, appliedFields, stale } = useContext(ActionContext);
    const { showPreview } = usePreviewModal();
    if (!action || !workflow) return null;

    // determine whether this field is applied
    const applied = appliedFields.includes(field);

    const newValue = action.config_changes[field];
    // Get the old value if this is an edit action
    let oldValue = undefined;
    if (action.action === 'edit') {
        if (action.config_type === 'tool') {
            // Find the tool in the workflow
            const tool = workflow.tools.find(t => t.name === action.name);
            if (tool) {
                oldValue = (tool as any)[field];
            }
        } else if (action.config_type === 'agent') {
            // Find the agent in the workflow
            const agent = workflow.agents.find(a => a.name === action.name);
            if (agent) {
                oldValue = (agent as any)[field];
            }
        } else if (action.config_type === 'prompt') {
            // Find the prompt in the workflow
            const prompt = workflow.prompts.find(p => p.name === action.name);
            if (prompt) {
                oldValue = (prompt as any)[field];
            }
        } else if (action.config_type === 'pipeline') {
            // Find the pipeline in the workflow
            const pipeline = workflow.pipelines?.find(p => p.name === action.name);
            if (pipeline) {
                oldValue = (pipeline as any)[field];
            }
        }
    }

    // if edit type of action, preview is enabled
    const previewCondition = action.action === 'edit' ||
        (action.config_type === 'agent' && field === 'instructions');

    // enable markdown preview for some fields
    const markdownPreviewCondition = (action.config_type === 'agent' && field === 'instructions') ||
        (action.config_type === 'agent' && field === 'examples') ||
        (action.config_type === 'prompt' && field === 'prompt') ||
        (action.config_type === 'tool' && field === 'description');
    
    // generate preview modal function
    const previewModalHandler = () => {
        if (previewCondition) {
            showPreview(
                oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : undefined,
                (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)),
                markdownPreviewCondition,
                `${action.name} - ${field}`,
                "Review changes",
                () => onApply(field)
            );
        }
    }

    return <div className="flex flex-col bg-white dark:bg-gray-800 rounded-sm">
        <div className="flex justify-between items-start">
            <div className="text-xs font-semibold px-2 py-1 text-gray-600 dark:text-gray-300">{field}</div>
            {previewCondition && <div className="flex gap-4 items-center bg-gray-50 dark:bg-gray-700 rounded-bl-sm rounded-tr-sm px-2 py-1">
                <button
                    className="text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white"
                    onClick={previewModalHandler}
                >
                    <EyeIcon size={16} />
                </button>
                {action.action === 'edit' && !action.error && <button
                    className={clsx("text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white", {
                        'text-green-600 dark:text-green-400': applied,
                        'text-gray-600 dark:text-gray-400': stale,
                    })}
                    onClick={() => onApply(field)}
                    disabled={stale || applied}
                >
                    <CheckIcon size={16} />
                </button>}
            </div>}
        </div>
        <div className="px-2 pb-1">
            <div className="text-sm italic truncate dark:text-gray-300">
                {JSON.stringify(newValue)}
            </div>
        </div>
    </div>;
}

export function StreamingAction({
    action,
    loading,
}: {
    action: {
        action?: 'create_new' | 'edit' | 'delete';
        config_type?: 'tool' | 'agent' | 'prompt' | 'pipeline' | 'start_agent' | 'one_time_trigger' | 'recurring_trigger' | 'external_trigger';
        name?: string;
    };
    loading: boolean;
}) {
    const [loadingStage, setLoadingStage] = useState<'fetching' | 'configuring'>('fetching');
    
    // After 3 seconds, switch to "configuring" stage
    useEffect(() => {
        const timer = setTimeout(() => {
            setLoadingStage('configuring');
        }, 3000);
        
        return () => clearTimeout(timer);
    }, []);

    // Use the same card container and header style as Action
    return (
        <div className={clsx(
            'flex flex-col rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-xs',
            'transition-shadow duration-150',
            {
                'border-l-2 border-l-blue-500': action.action == 'create_new',
                'border-l-2 border-l-yellow-500': action.action == 'edit',
                'border-l-2 border-l-red-500': action.action == 'delete',
                'border-l-2 border-l-gray-400': !action.action,
            }
        )}>
            <div className="flex items-center gap-2 px-2 py-1 border-b border-zinc-100 dark:border-zinc-800">
                {/* Small colored icon for type */}
                <span className={clsx(
                    'inline-flex items-center justify-center rounded-full h-5 w-5 text-xs',
                    {
                        'bg-blue-100 text-blue-600': action.action == 'create_new',
                        'bg-yellow-100 text-yellow-600': action.action == 'edit',
                        'bg-red-100 text-red-600': action.action == 'delete',
                        'bg-gray-200 text-gray-600': !action.action,
                    }
                )}>
                    {action.config_type === 'agent' ? '🧑‍💼' : action.config_type === 'tool' ? '🛠️' : action.config_type === 'pipeline' ? '⚙️' : action.config_type === 'start_agent' ? '🏁' : action.config_type === 'one_time_trigger' ? '⏰' : action.config_type === 'recurring_trigger' ? '🔄' : action.config_type === 'external_trigger' ? '🔗' : '💬'}
                </span>
                <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-100 truncate flex-1">
                    {action.action === 'create_new' ? 'Add' : action.action === 'edit' ? 'Edit' : 'Delete'} {action.config_type}: {action.name}
                </span>
            </div>
            {/* Loading state body */}
            <div className="px-3 py-4 text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 min-h-[32px]">
                <Spinner size="sm" />
                <span className="animate-pulse">
                    {loadingStage === 'fetching' 
                        ? (action.config_type === 'agent' 
                            ? `Creating agent...`
                            : action.config_type === 'pipeline'
                            ? `Creating pipeline...`
                            : `Fetching ${action.config_type} definition...`)
                        : (action.config_type === 'agent'
                            ? `Configuring agent...`
                            : action.config_type === 'pipeline'
                            ? `Configuring pipeline...`
                            : `Configuring ${action.config_type}...`)
                    }
                </span>
            </div>
        </div>
    );
}
