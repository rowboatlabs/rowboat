'use client';
import { cn, Input } from "@heroui/react";
import { createProject } from "../../actions/project_actions";
import { templates } from "../../lib/project_templates";
import { WorkflowTemplate } from "../../lib/types/workflow_types";
import { FormStatusButton } from "../../lib/components/form-status-button";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import { useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";

function TemplateCard({
    templateKey,
    template,
    onSelect,
    selected
}: {
    templateKey: string,
    template: z.infer<typeof WorkflowTemplate>,
    onSelect: (templateKey: string) => void,
    selected: boolean
}) {
    return <button
        className={cn(
            "relative flex flex-col gap-2 rounded p-4 pt-6 shadow-sm",
            "border border-gray-300 dark:border-gray-700",
            "hover:border-gray-500 dark:hover:border-gray-500",
            "bg-white dark:bg-gray-900",
            selected && "border-gray-800 dark:border-gray-300 shadow-md"
        )}
        type="button"
        onClick={() => onSelect(templateKey)}
    >
        {selected && <div className="absolute top-0 right-0 bg-gray-200 dark:bg-gray-800 flex items-center justify-center rounded p-1">
            <CheckIcon size={16} />
        </div>}
        <div className="text-lg dark:text-gray-100">{template.name}</div>
        <div className="shrink-0 text-sm text-gray-500 dark:text-gray-400 text-left">{template.description}</div>
    </button>
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
    const { default: defaultTemplate, ...otherTemplates } = templates;

    function handleTemplateClick(templateKey: string) {
        setSelectedTemplate(templateKey);
    }

    return <div className="h-full pt-4 px-4 overflow-auto bg-gray-50 dark:bg-gray-950">
        <div className="max-w-[768px] mx-auto p-4 bg-white dark:bg-gray-900 rounded-lg">
            <div className="text-lg pb-2 border-b border-b-gray-100 dark:border-b-gray-800 dark:text-gray-100">Create a new project</div>
            <form className="mt-4 flex flex-col gap-4" action={createProject}>
                <Input
                    required
                    name="name"
                    label="Name this project"
                    placeholder="Project name or description (internal only)"
                    variant="bordered"
                    labelPlacement="outside"
                />
                <input type="hidden" name="template" value={selectedTemplate} />
                <div className="text-sm dark:text-gray-300">Select a template</div>
                <div className="grid grid-cols-3 gap-4">
                    <TemplateCard
                        key="default"
                        templateKey="default"
                        template={defaultTemplate}
                        onSelect={handleTemplateClick}
                        selected={selectedTemplate === 'default'}
                    />
                    {Object.entries(otherTemplates).map(([key, template]) => (
                        <TemplateCard
                            key={key}
                            templateKey={key}
                            template={template}
                            onSelect={handleTemplateClick}
                            selected={selectedTemplate === key}
                        />
                    ))}
                </div>
                <Submit />
            </form>
        </div>
    </div>;
}
