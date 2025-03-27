'use client';

import { Project } from "../../lib/types/project_types";
import { useEffect, useState, useMemo } from "react";
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
import Fuse from 'fuse.js';
import { SearchInput, TimeFilter } from "./components/search-input";
import { isToday, isThisWeek, isThisMonth } from "@/lib/utils/date";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";

interface SearchOptions {
    query: string;
    timeFilter: TimeFilter;
}

export default function App() {
    const router = useRouter();
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Project creation state
    const [selectedTemplate, setSelectedTemplate] = useState<string>('default');
    const [selectedType, setSelectedType] = useState<"template" | "prompt">("template");
    const [customPrompt, setCustomPrompt] = useState<string>('');
    const { default: defaultTemplate, ...otherTemplates } = templates;

    const [searchOptions, setSearchOptions] = useState<SearchOptions>({
        query: '',
        timeFilter: 'all'
    });

    const fuseOptions = {
        keys: ['name'],
        threshold: 0.3,
        distance: 100,
        minMatchCharLength: 2,
        shouldSort: true,
        includeScore: true,
    };

    const fuse = useMemo(() => {
        return new Fuse(projects, fuseOptions);
    }, [projects]);

    const filteredProjects = useMemo(() => {
        if (!searchOptions.query.trim() && searchOptions.timeFilter === 'all') {
            return projects;
        }

        let results = projects;

        if (searchOptions.query.trim()) {
            const fuseResults = fuse.search(searchOptions.query);
            results = fuseResults
                .filter(result => result.score && result.score < 0.6)
                .map(result => result.item);
        }

        if (searchOptions.timeFilter !== 'all') {
            results = results.filter(project => {
                const projectDate = new Date(project.createdAt);
                switch (searchOptions.timeFilter) {
                    case 'today':
                        return isToday(projectDate);
                    case 'week':
                        return isThisWeek(projectDate);
                    case 'month':
                        return isThisMonth(projectDate);
                    default:
                        return true;
                }
            });
        }

        return results;
    }, [projects, searchOptions, fuse]);

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
                    <section className="card overflow-hidden">
                        <div className="px-4 pt-4">
                            <SectionHeading
                                subheading="Choose from your existing projects"
                            >
                                Select a project
                            </SectionHeading>
                            <div className="py-4">
                                <SearchInput
                                    value={searchOptions.query}
                                    onChange={(query) => setSearchOptions(prev => ({ ...prev, query }))}
                                    timeFilter={searchOptions.timeFilter}
                                    onTimeFilterChange={(timeFilter) => setSearchOptions(prev => ({ ...prev, timeFilter }))}
                                />
                            </div>
                        </div>
                        <div className="h-4"></div>
                        <HorizontalDivider />
                        <ProjectList 
                            projects={filteredProjects}
                            isLoading={isLoading}
                            searchQuery={searchOptions.query}
                        />
                    </section>

                    {/* Right side: Project Creation */}
                    <section className="card">
                        <div className="px-4 pt-4">
                            <SectionHeading
                                subheading="Set up a new AI assistant"
                            >
                                Create a new project
                            </SectionHeading>
                        </div>
                        
                        <form className="px-4 pt-4 space-y-6" action={handleSubmit}>
                            <div>
                                <SectionHeading>Name your assistant</SectionHeading>
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
                                    <SectionHeading>Enter a prompt</SectionHeading>
                                    <CustomPromptCard
                                        onSelect={() => handleTemplateClick('custom', 'prompt')}
                                        selected={selectedTemplate === 'custom' && selectedType === "prompt"}
                                        onPromptChange={setCustomPrompt}
                                        customPrompt={customPrompt}
                                    />
                                </div>

                                <div>
                                    <SectionHeading>Or start with one of our examples</SectionHeading>
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
                            </div>

                            <div className="pt-4">
                                <HorizontalDivider />
                                <div className="mt-4">
                                    <Submit />
                                </div>
                            </div>
                        </form>
                    </section>
                </div>
            </div>
        </div>
    );
} 