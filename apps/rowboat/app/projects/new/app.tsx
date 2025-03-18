'use client';
import { cn, Input, Textarea } from "@heroui/react";
import { createProject, createProjectFromPrompt } from "../../actions/project_actions";
import { templates, starting_copilot_prompts } from "../../lib/project_templates";
import { WorkflowTemplate } from "../../lib/types/workflow_types";
import { FormStatusButton } from "../../lib/components/form-status-button";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import { useState } from "react";
import { CheckIcon, PlusIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useRouter } from 'next/navigation';
import React from "react";

function CustomPromptCard({
    onSelect,
    selected,
    onPromptChange,
    customPrompt
}: {
    onSelect: () => void,
    selected: boolean,
    onPromptChange: (prompt: string) => void,
    customPrompt: string
}) {
    return <button
        className={cn(
            "relative flex flex-col gap-2 rounded p-4 pt-6 shadow-sm w-full",
            "border border-gray-300 dark:border-gray-700",
            "hover:border-gray-500 dark:hover:border-gray-500",
            "bg-white dark:bg-gray-900",
            selected && "border-gray-800 dark:border-gray-300 shadow-md"
        )}
        type="button"
        onClick={onSelect}
    >
        {selected && <div className="absolute top-0 right-0 bg-gray-200 dark:bg-gray-800 flex items-center justify-center rounded p-1">
            <CheckIcon size={16} />
        </div>}
        <div className="text-lg dark:text-gray-100 text-left">Custom Prompt</div>
        {selected ? (
            <Textarea
                placeholder="Enter your custom prompt here..."
                value={customPrompt}
                onChange={(e) => {
                    e.stopPropagation();
                    onPromptChange(e.target.value);
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-h-[100px] text-sm w-full"
            />
        ) : (
            <div 
                className={cn(
                    "min-h-[60px] w-full p-2 text-sm text-gray-500 dark:text-gray-400 text-left",
                    "border border-gray-200 dark:border-gray-700 rounded",
                    "bg-gray-50 dark:bg-gray-800"
                )}
            >
                &ldquo;Create an assistant for a food delivery app that can take new orders, cancel existing orders and answer questions about refund policies&rdquo;
            </div>
        )}
    </button>
}

function TemplateCard({
    templateKey,
    template,
    onSelect,
    selected,
    type = "template"
}: {
    templateKey: string,
    template: z.infer<typeof WorkflowTemplate> | string,
    onSelect: (templateKey: string) => void,
    selected: boolean,
    type?: "template" | "prompt"
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const name = typeof template === "string" ? templateKey : template.name;
    const description = typeof template === "string" 
        ? `"${template}"`
        : template.description;

    // Check if text needs expansion button
    const textRef = React.useRef<HTMLDivElement>(null);
    const [needsExpansion, setNeedsExpansion] = useState(false);

    React.useEffect(() => {
        if (textRef.current) {
            const needsButton = textRef.current.scrollHeight > textRef.current.clientHeight;
            setNeedsExpansion(needsButton);
        }
    }, [description]);

    return <div
        className={cn(
            "relative flex flex-col rounded p-4 pt-6 shadow-sm cursor-pointer",
            "border border-gray-300 dark:border-gray-700",
            "hover:border-gray-500 dark:hover:border-gray-500",
            "bg-white dark:bg-gray-900",
            selected && "border-gray-800 dark:border-gray-300 shadow-md",
            isExpanded ? "h-auto" : "h-[160px]"
        )}
        onClick={() => onSelect(templateKey)}
    >
        {selected && <div className="absolute top-0 right-0 bg-gray-200 dark:bg-gray-800 flex items-center justify-center rounded p-1">
            <CheckIcon size={16} />
        </div>}
        
        <div className="flex flex-col h-full">
            <div className="text-lg dark:text-gray-100 text-left mb-2">{name}</div>
            <div className="relative flex-1">
                <div 
                    ref={textRef}
                    className={cn(
                        "text-sm text-gray-500 dark:text-gray-400 text-left pr-6",
                        !isExpanded && "line-clamp-3"
                    )}
                >
                    {description}
                </div>
                {needsExpansion && (
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(!isExpanded);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsExpanded(!isExpanded);
                            }
                        }}
                        className={cn(
                            "absolute right-0 p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer",
                            isExpanded ? "relative mt-1" : "bottom-0"
                        )}
                        aria-label={isExpanded ? "Show less" : "Show more"}
                    >
                        {isExpanded ? (
                            <ChevronUpIcon size={16} />
                        ) : (
                            <ChevronDownIcon size={16} />
                        )}
                    </div>
                )}
            </div>
        </div>
    </div>
}

function Submit() {
    const { pending } = useFormStatus();

    return <>
        {pending && <div className="text-gray-400">Please hold on while we set up your project&hellip;</div>}
        <FormStatusButton
            props={{
                type: "submit",
                children: "Create project",
                className: "self-start",
                startContent: <PlusIcon size={16} />,
            }}
        />
    </>;
}

export default function App() {
    const [selectedTemplate, setSelectedTemplate] = useState<string>('default');
    const [selectedType, setSelectedType] = useState<"template" | "prompt">("template");
    const [customPrompt, setCustomPrompt] = useState<string>('');
    const { default: defaultTemplate, ...otherTemplates } = templates;
    const router = useRouter();

    function handleTemplateClick(templateKey: string, type: "template" | "prompt" = "template") {
        setSelectedTemplate(templateKey);
        setSelectedType(type);
    }

    async function handleSubmit(formData: FormData) {
        if (selectedType === "template") {
            console.log('Creating template project');
            return await createProject(formData);
        }

        if (selectedType === "prompt") {
            console.log('Starting prompt-based project creation');
            try {
                const newFormData = new FormData();
                const projectName = formData.get('name') as string;
                const promptText = selectedTemplate === 'custom' 
                    ? customPrompt 
                    : starting_copilot_prompts[selectedTemplate];
                
                newFormData.append('name', projectName);
                newFormData.append('prompt', promptText);
                
                console.log('Creating project...');
                const response = await createProjectFromPrompt(newFormData);
                console.log('Create project response:', response);
                
                if (!response?.id) {
                    throw new Error('Project creation failed - no project ID returned');
                }

                const params = new URLSearchParams({
                    prompt: promptText,
                    autostart: 'true'
                });
                const url = `/projects/${response.id}/workflow?${params.toString()}`;
                
                console.log('Navigating to:', url);
                window.location.href = url;
            } catch (error) {
                console.error('Error creating project:', error);
            }
        }
    }

    return <div className="h-full pt-4 px-4 overflow-auto bg-gray-50 dark:bg-gray-950">
        <div className="max-w-[768px] mx-auto p-4 bg-white dark:bg-gray-900 rounded-lg">
            <div className="text-lg pb-2 border-b border-b-gray-100 dark:border-b-gray-800 dark:text-gray-100 text-left">Create a new project</div>
            <form className="mt-4 flex flex-col gap-6" action={handleSubmit}>
                <div>
                    <div className="text-lg dark:text-gray-300 mb-4 text-left">Name your assistant</div>
                    <Input
                        required
                        name="name"
                        placeholder="Give an internal name for your assistant"
                        variant="bordered"
                    />
                </div>
                <input type="hidden" name="template" value={selectedTemplate} />
                <input type="hidden" name="type" value={selectedType} />

                <div className="space-y-8">
                    <div>
                        <div className="text-lg dark:text-gray-300 mb-4 text-left">Tell us what you would like to build</div>
                        <CustomPromptCard
                            onSelect={() => handleTemplateClick('custom', 'prompt')}
                            selected={selectedTemplate === 'custom' && selectedType === "prompt"}
                            onPromptChange={setCustomPrompt}
                            customPrompt={customPrompt}
                        />
                    </div>

                    <div>
                        <div className="text-lg dark:text-gray-300 mb-4 text-left">Or start with an example starting prompt</div>
                        <div className="grid grid-cols-3 gap-4">
                            {Object.entries(starting_copilot_prompts).map(([key, prompt]) => (
                                <TemplateCard
                                    key={key}
                                    templateKey={key}
                                    template={prompt}
                                    onSelect={(key) => handleTemplateClick(key, "prompt")}
                                    selected={selectedTemplate === key && selectedType === "prompt"}
                                    type="prompt"
                                />
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="text-lg dark:text-gray-300 mb-4 text-left">Or choose a pre-built example assistant</div>
                        <div className="grid grid-cols-3 gap-4">
                            <TemplateCard
                                key="default"
                                templateKey="default"
                                template={defaultTemplate}
                                onSelect={(key) => handleTemplateClick(key, "template")}
                                selected={selectedTemplate === 'default' && selectedType === "template"}
                            />
                            {Object.entries(otherTemplates).map(([key, template]) => (
                                <TemplateCard
                                    key={key}
                                    templateKey={key}
                                    template={template}
                                    onSelect={(key) => handleTemplateClick(key, "template")}
                                    selected={selectedTemplate === key && selectedType === "template"}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <Submit />
            </form>
        </div>
    </div>;
}