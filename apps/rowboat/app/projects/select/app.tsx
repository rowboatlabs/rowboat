'use client';

import { Project } from "../../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects, createProject, createProjectFromPrompt } from "../../actions/project_actions";
import { useRouter } from 'next/navigation';
import { tokens } from "@/app/styles/tokens";
import { cn } from "@heroui/react";
import { templates, starting_copilot_prompts } from "../../lib/project_templates";
import { ProjectList } from "./components/project-list";
import { CustomPromptCard } from "./components/custom-prompt-card";
import { TemplateCard } from "./components/template-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { Textarea } from "@/components/ui/textarea";
import { Submit } from "./components/submit-button";

export default function App() {
    const router = useRouter();
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Project creation state
    const [selectedTemplate, setSelectedTemplate] = useState<string>('default');
    const [selectedType, setSelectedType] = useState<"template" | "prompt">("template");
    const [customPrompt, setCustomPrompt] = useState<string>('');
    const { default: defaultTemplate, ...otherTemplates } = templates;

    useEffect(() => {
        let ignore = false;

        async function fetchProjects() {
            setIsLoading(true);
            const projects = await listProjects();
            if (!ignore) {
                setProjects(projects);
                setIsLoading(false);
            }
        }

        fetchProjects();

        return () => {
            ignore = true;
        }
    }, []);

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

    return (
        <div className={cn(
            "min-h-full",
            tokens.colors.background.light,
            tokens.colors.background.dark
        )}>
            <div className={cn(
                "max-w-screen-2xl mx-auto",
                "px-4 sm:px-6 lg:px-8",
                "py-8"
            )}>
                {/* Page Header */}
                <div className="mb-8">
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
                        Projects
                    </h1>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">
                        Select an existing project or create a new one
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[400px,1fr] gap-8">
                    {/* Left side: Project Selection */}
                    <section className="card space-y-6">
                        <div>
                            <SectionHeading>Select a project</SectionHeading>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                Choose from your existing projects
                            </p>
                        </div>
                        <ProjectList projects={projects} isLoading={isLoading} />
                    </section>

                    {/* Right side: Project Creation */}
                    <section className="card space-y-6">
                        <div>
                            <SectionHeading>Create a new project</SectionHeading>
                            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                Set up a new AI assistant
                            </p>
                        </div>
                        
                        <form className="space-y-6" action={handleSubmit}>
                            <div>
                                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Assistant name
                                </label>
                                <Textarea
                                    required
                                    name="name"
                                    placeholder="Give an internal name for your assistant"
                                    className="mt-1 min-h-[60px]"
                                />
                            </div>

                            <input type="hidden" name="template" value={selectedTemplate} />
                            <input type="hidden" name="type" value={selectedType} />

                            <div className="space-y-6">
                                <div>
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Assistant configuration
                                    </label>
                                    <CustomPromptCard
                                        onSelect={() => handleTemplateClick('custom', 'prompt')}
                                        selected={selectedTemplate === 'custom' && selectedType === "prompt"}
                                        onPromptChange={setCustomPrompt}
                                        customPrompt={customPrompt}
                                    />
                                </div>

                                <div>
                                    <SectionHeading>Example starting prompts</SectionHeading>
                                    <div className={cn(
                                        "grid gap-4",
                                        "grid-cols-1",
                                        "xl:grid-cols-2"
                                    )}>
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
                                    <SectionHeading>Pre-built examples</SectionHeading>
                                    <div className={cn(
                                        "grid gap-4",
                                        "grid-cols-1",
                                        "xl:grid-cols-2"
                                    )}>
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

                            <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                                <Submit />
                            </div>
                        </form>
                    </section>
                </div>
            </div>
        </div>
    );
} 