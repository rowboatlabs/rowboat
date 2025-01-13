'use client';
import { createContext, useContext, useState } from "react";
import clsx from "clsx";
import { z } from "zod";
import { Workflow, CopilotAssistantMessage, CopilotAssistantMessageActionPart } from "@/app/lib/types";
import { PreviewModalProvider, usePreviewModal } from './preview-modal';
import { getAppliedChangeKey } from "./copilot";

const ActionContext = createContext<{
    msgIndex: number;
    actionIndex: number;
    action: z.infer<typeof CopilotAssistantMessageActionPart>['content'] | null;
    workflow: z.infer<typeof Workflow> | null;
    handleApplyChange: (messageIndex: number, actionIndex: number, field?: string) => void;
    appliedFields: string[];
    stale: boolean;
}>({ msgIndex: 0, actionIndex: 0, action: null, workflow: null, handleApplyChange: () => {}, appliedFields: [], stale: false });

export function Action({
    msgIndex,
    actionIndex,
    action,
    workflow,
    handleApplyChange,
    appliedChanges,
    stale,
}: {
    msgIndex: number;
    actionIndex: number;
    action: z.infer<typeof CopilotAssistantMessageActionPart>['content'];
    workflow: z.infer<typeof Workflow>;
    handleApplyChange: (messageIndex: number, actionIndex: number, field?: string) => void;
    appliedChanges: Record<string, boolean>;
    stale: boolean;
}) {
    const [expanded, setExpanded] = useState(Object.entries(action.config_changes).length <= 2);
    const changes = Object.entries(action.config_changes).slice(0, expanded ? undefined : 2);

    // determine whether all changes contained in this action are applied
    const appliedFields = Object.keys(action.config_changes).filter(key => appliedChanges[getAppliedChangeKey(msgIndex, actionIndex, key)]);
    console.log('appliedFields', appliedFields);

    return <div className={clsx('flex flex-col rounded-sm border shadow-sm', {
        'bg-blue-50 border-blue-200': action.action === 'create_new',
        'bg-amber-50 border-amber-200': action.action === 'edit',
        'bg-gray-50 border-gray-200': stale,
    })}>
        <ActionContext.Provider value={{ msgIndex, actionIndex, action, workflow, handleApplyChange, appliedFields, stale }}>
            <ActionHeader />
            <PreviewModalProvider>
                <ActionBody>
                    {changes.map(([key, value]) => {
                        return <ActionField key={key} field={key} />
                    })}
                </ActionBody>
            </PreviewModalProvider>
            {Object.entries(action.config_changes).length > 2 && <button className={clsx('flex rounded-b-sm flex-col items-center justify-center', {
                'bg-blue-100 hover:bg-blue-200 text-blue-600': action.action === 'create_new',
                'bg-amber-100 hover:bg-amber-200 text-amber-600': action.action === 'edit',
                'bg-gray-100 hover:bg-gray-200 text-gray-600': stale,
            })} onClick={() => setExpanded(!expanded)}>
                {expanded ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevrons-up"><path d="m17 11-5-5-5 5" /><path d="m17 18-5-5-5 5" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevrons-down"><path d="m7 6 5 5 5-5" /><path d="m7 13 5 5 5-5" /></svg>
                )}
            </button>}
        </ActionContext.Provider>
    </div>;
}

export function ActionHeader() {
    const { msgIndex, actionIndex, action, workflow, handleApplyChange, appliedFields, stale } = useContext(ActionContext);
    if (!action || !workflow) return null;

    const targetType = action.config_type === 'tool' ? 'tool' : action.config_type === 'agent' ? 'agent' : 'prompt';
    const change = action.action === 'create_new' ? 'Create' : 'Edit';

    // determine whether all changes contained in this action are applied
    const allApplied = Object.keys(action.config_changes).every(key => appliedFields.includes(key));

    // generate apply change function
    const applyChangeHandler = () => {
        handleApplyChange(msgIndex, actionIndex);
    }

    return <div className={clsx('flex justify-between items-center px-2 py-1 rounded-t-sm', {
        'bg-blue-100': action.action === 'create_new',
        'bg-amber-100': action.action === 'edit',
        'bg-gray-100': stale,
    })}>
        <div className={clsx('text-sm truncate', {
            'text-blue-600': action.action === 'create_new',
            'text-amber-600': action.action === 'edit',
            'text-gray-600': stale,
        })}>{`${change} ${targetType}`}: <span className="font-medium">{action.name}</span></div>
        <button className={clsx('flex gap-1 items-center text-sm hover:text-black', {
            'text-blue-600': action.action === 'create_new',
            'text-amber-600': action.action === 'edit',
            'text-green-600': allApplied,
            'text-gray-600': stale,
        })}
            onClick={applyChangeHandler}
            disabled={stale || allApplied}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check-check"><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></svg>
            {!allApplied && <div className="font-medium">Apply</div>}
        </button>
    </div>;
}

export function ActionBody({
    children,
}: {
    children: React.ReactNode;
}) {
    return <div className="flex flex-col gap-2 p-2">{children}</div>;
}

export function ActionField({
    field,
}: {
    field: string;
}) {
    const { msgIndex, actionIndex, action, workflow, handleApplyChange, appliedFields, stale } = useContext(ActionContext);
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
                oldValue = tool[field as keyof typeof tool];
            }
        } else if (action.config_type === 'agent') {
            // Find the agent in the workflow
            const agent = workflow.agents.find(a => a.name === action.name);
            if (agent) {
                oldValue = agent[field as keyof typeof agent];
            }
        } else if (action.config_type === 'prompt') {
            // Find the prompt in the workflow
            const prompt = workflow.prompts.find(p => p.name === action.name);
            if (prompt) {
                oldValue = prompt[field as keyof typeof prompt];
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
                `${action.name} - ${field}`
            );
        }
    }

    // generate apply change function
    const applyChangeHandler = () => {
        handleApplyChange(msgIndex, actionIndex, field);
    }

    return <div className="flex flex-col bg-white rounded-sm">
        <div className="flex justify-between items-start">
            <div className={clsx('text-xs font-semibold px-2 py-1', {
                'text-blue-600': action.action === 'create_new',
                'text-amber-600': action.action === 'edit',
                'text-gray-600': stale,
            })}>{field}</div>
            {previewCondition && <div className="flex gap-4 items-center bg-gray-50 rounded-bl-sm rounded-tr-sm px-2 py-1">
                <button
                    className="text-gray-500 hover:text-black"
                    onClick={previewModalHandler}
                >
                    <svg className="w-[16px] h-[16px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeWidth="1.5" d="M21 12c0 1.2-4.03 6-9 6s-9-4.8-9-6c0-1.2 4.03-6 9-6s9 4.8 9 6Z" />
                        <path stroke="currentColor" strokeWidth="1.5" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                </button>
                {action.action === 'edit' && <button
                    className={clsx("text-gray-500 hover:text-black", {
                        'text-green-600': applied,
                        'text-gray-600': stale,
                    })}
                    onClick={applyChangeHandler}
                    disabled={stale || applied}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-check"><path d="M20 6 9 17l-5-5" /></svg>
                </button>}
            </div>}
        </div>
        <div className="px-2 pb-1">
            <div className="text-sm italic truncate">
                {JSON.stringify(newValue)}
            </div>
        </div>
    </div>;
}


// function ActionToolParamsView({
//     params,
// }: {
//     params: z.infer<typeof Workflow>['tools'][number]['parameters'];
// }) {
//     const required = params?.required || [];

//     return <ActionField label="parameters">
//         <div className="flex flex-col gap-2 text-sm">
//             {Object.entries(params?.properties || {}).map(([paramName, paramConfig]) => {
//                 return <div className="flex flex-col gap-1">
//                     <div className="flex gap-1 items-center">
//                         <svg className="w-[16px] h-[16px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
//                             <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M5 12h14" />
//                         </svg>
//                         <div>{paramName}{required.includes(paramName) && <sup>*</sup>}</div>
//                         <div className="text-gray-500">{paramConfig.type}</div>
//                     </div>
//                     <div className="flex gap-1 ml-4">
//                         <div className="text-gray-500 italic">{paramConfig.description}</div>
//                     </div>
//                 </div>;
//             })}
//         </div>
//     </ActionField>;
// }

// function ActionAgentToolsView({
//     action,
//     tools,
// }: {
//     action: z.infer<typeof CopilotAssistantMessage>['content']['Actions'][number];
//     tools: z.infer<typeof Workflow>['agents'][number]['tools'];
// }) {
//     const { workflow } = useContext(CopilotContext);
//     if (!workflow) {
//         return <></>;
//     }

//     // find the agent in the workflow
//     const agent = workflow.agents.find((agent) => agent.name === action.name);
//     if (!agent) {
//         return <></>;
//     }

//     // find the tools that were removed
//     const removedTools = agent.tools.filter((tool) => !tools.includes(tool));

//     return <ActionField label="tools">
//         {removedTools.length > 0 && <div className="flex flex-col gap-1 text-sm">
//             <div className="text-gray-500 italic">The following tools were removed:</div>
//             <div className="flex flex-col gap-1">
//                 {removedTools.map((tool) => {
//                     return <div className="flex gap-1 items-center">
//                         <svg className="w-[16px] h-[16px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
//                             <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M5 12h14" />
//                         </svg>
//                         <div>{tool}</div>
//                     </div>;
//                 })}
//             </div>
//         </div>}
//         <div className="flex flex-col gap-1 text-sm">
//             <div className="text-gray-500 italic">The following tools were added:</div>
//             <div className="flex flex-col gap-1">
//                 {tools.map((tool) => {
//                     return <div className="flex gap-1 items-center">
//                         <svg className="w-[16px] h-[16px]" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
//                             <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M5 12h14" />
//                         </svg>
//                         <div>{tool}</div>
//                     </div>;
//                 })}
//             </div>
//         </div>
//     </ActionField>;
// }
