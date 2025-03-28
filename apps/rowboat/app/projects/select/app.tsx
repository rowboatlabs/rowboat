'use client';

import { Project } from "../../lib/types/project_types";
import { useEffect, useState } from "react";
import { z } from "zod";
import { listProjects, createProject, createProjectFromPrompt } from "../../actions/project_actions";
import { useRouter } from 'next/navigation';
import { tokens } from "@/app/styles/design-tokens";
import { cn } from "@heroui/react";
import { templates } from "@/app/lib/project_templates";
import { SectionHeading } from "@/components/ui/section-heading";
import { Textarea } from "@/components/ui/textarea";
import { TimeFilter } from "./components/search-input";
import { TemplateCardsList } from "./components/template-cards-list";
import { SearchProjects } from "./components/search-projects";
import { CustomPromptCard } from "./components/custom-prompt-card";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SearchOptions {
    query: string;
    timeFilter: TimeFilter;
}

function Submit() {
    return (
        <Button
            type="submit"
            className={cn(
                "self-start",
                tokens.typography.sizes.sm,
                tokens.typography.weights.medium,
                "px-4 py-2",
                tokens.colors.accent.primary,
                tokens.colors.accent.primaryDark,
                "transform hover:scale-[1.02] hover:brightness-105",
                tokens.transitions.default
            )}
            startContent={<PlusIcon size={16} />}
        >
            Create project
        </Button>
    );
}

export default function App() {
    const [projects, setProjects] = useState<z.infer<typeof Project>[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    const [selectedCard, setSelectedCard] = useState<'custom' | any>('custom');
    const [customPrompt, setCustomPrompt] = useState("Create a customer support assistant with one example agent");
    const [name, setName] = useState("");
    const [defaultName, setDefaultName] = useState('Untitled 1');

    const [searchOptions, setSearchOptions] = useState<SearchOptions>({
        query: '',
        timeFilter: 'all'
    });

    // Add new state for active pane
    const [activePane, setActivePane] = useState<'select' | 'create' | null>(null);

    const getNextUntitledNumber = (projects: z.infer<typeof Project>[]) => {
        const untitledProjects = projects
            .map(p => p.name)
            .filter(name => name.startsWith('Untitled '))
            .map(name => {
                const num = parseInt(name.replace('Untitled ', ''));
                return isNaN(num) ? 0 : num;
            });

        if (untitledProjects.length === 0) return 1;
        return Math.max(...untitledProjects) + 1;
    };

    useEffect(() => {
        let ignore = false;

        async function fetchProjects() {
            setIsLoading(true);
            const projects = await listProjects();
            if (!ignore) {
                // Sort projects by createdAt in descending order (newest first)
                const sortedProjects = [...projects].sort((a, b) => 
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                );
                
                setProjects(sortedProjects);
                setIsLoading(false);
                const nextNumber = getNextUntitledNumber(sortedProjects);
                const newDefaultName = `Untitled ${nextNumber}`;
                setDefaultName(newDefaultName);
                setName(newDefaultName);
            }
        }

        fetchProjects();

        return () => {
            ignore = true;
        }
    }, []);

    const handleCardSelect = (card: 'custom' | any) => {
        setSelectedCard(card);
        
        if (card === 'custom') {
            setCustomPrompt("Create a customer support assistant with one example agent");
        } else {
            setCustomPrompt(card.prompt || card.description);
        }
    };

    const router = useRouter();

    async function handleSubmit(formData: FormData) {
        // Check if it's a template (from templates object) or a copilot prompt
        const isTemplate = selectedCard?.id && selectedCard.id in templates;

        if (selectedCard === 'custom' || !isTemplate) {
            // Handle custom prompt or copilot starting prompts
            console.log('Creating project from prompt');
            try {
                const newFormData = new FormData();
                newFormData.append('name', name);
                newFormData.append('prompt', selectedCard === 'custom' ? customPrompt : selectedCard.prompt);
                
                const response = await createProjectFromPrompt(newFormData);
                
                if (!response?.id) {
                    throw new Error('Project creation failed');
                }

                const params = new URLSearchParams({
                    prompt: selectedCard === 'custom' ? customPrompt : selectedCard.prompt,
                    autostart: 'true'
                });
                window.location.href = `/projects/${response.id}/workflow?${params.toString()}`;
            } catch (error) {
                console.error('Error creating project:', error);
            }
        } else {
            // Handle regular template
            console.log('Creating template project');
            try {
                const newFormData = new FormData();
                newFormData.append('name', name);
                newFormData.append('template', selectedCard.id);
                return await createProject(newFormData);
            } catch (error) {
                console.error('Error creating project:', error);
            }
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault();
            const formData = new FormData();
            formData.append('name', name);
            handleSubmit(formData);
        }
    };

    return (
        <div className={cn(
            "min-h-full",
            tokens.colors.light.background,
            tokens.colors.dark.background
        )}>
            <div className={cn(
                "max-w-screen-2xl mx-auto",
                "px-4 sm:px-6 lg:px-8",
                "py-8 space-y-8"
            )}>
                {/* Page Header */}
                <div>
                    <h1 className={cn(
                        tokens.typography.weights.semibold,
                        tokens.typography.sizes["2xl"],
                        tokens.colors.light.text.primary,
                        tokens.colors.dark.text.primary
                    )}>
                        Projects
                    </h1>
                    <p className={cn(
                        "mt-2",
                        tokens.typography.sizes.base,
                        tokens.colors.light.text.secondary,
                        tokens.colors.dark.text.secondary
                    )}>
                        Select an existing project or create a new one
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[400px,1fr] gap-8">
                    {/* Left side: Project Selection */}
                    <div 
                        className={cn(
                            "transition-all duration-300",
                            "h-full",
                            "hover:scale-[1.03] hover:z-10",
                            activePane === 'select' && "scale-[1.03] z-10",
                            activePane === 'create' && "scale-[0.97] opacity-60"
                        )}
                        onMouseEnter={() => setActivePane('select')}
                        onMouseLeave={() => setActivePane(null)}
                        onClick={() => setActivePane('select')}
                    >
                        <SearchProjects
                            projects={projects}
                            isLoading={isLoading}
                            searchOptions={searchOptions}
                            onSearchOptionsChange={setSearchOptions}
                            heading="Select an existing project"
                            subheading="Choose from your projects"
                            className="h-full"
                        />
                    </div>

                    {/* Right side: Project Creation */}
                    <div 
                        className={cn(
                            "transition-all duration-300",
                            "h-full",
                            "hover:scale-[1.03] hover:z-10",
                            activePane === 'create' && "scale-[1.03] z-10",
                            activePane === 'select' && "scale-[0.97] opacity-60"
                        )}
                        onMouseEnter={() => setActivePane('create')}
                        onMouseLeave={() => setActivePane(null)}
                        onClick={() => setActivePane('create')}
                    >
                        <section className="card h-full">
                            <div className="px-4 pt-4 flex justify-between items-start">
                                <div>
                                    <SectionHeading
                                        subheading="Set up a new AI assistant"
                                    >
                                        Create a new project
                                    </SectionHeading>
                                </div>
                                <div className="pt-1">
                                    <Button
                                        type="submit"
                                        form="create-project-form"
                                        className={cn(
                                            tokens.typography.sizes.sm,
                                            tokens.typography.weights.medium,
                                            "px-4 py-2",
                                            tokens.colors.accent.primary,
                                            tokens.colors.accent.primaryDark,
                                            "transform hover:scale-[1.02] hover:brightness-105",
                                            tokens.transitions.default
                                        )}
                                        startContent={<PlusIcon size={16} />}
                                    >
                                        Create project
                                    </Button>
                                </div>
                            </div>
                            
                            <form
                                id="create-project-form"
                                action={handleSubmit}
                                onKeyDown={handleKeyDown}
                                className="px-4 pt-4 pb-8 space-y-6"
                            >
                                <div className="space-y-3">
                                    <SectionHeading>Name your assistant</SectionHeading>
                                    <Textarea
                                        required
                                        name="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="min-h-[60px]"
                                        placeholder={defaultName}
                                    />
                                </div>

                                <input type="hidden" name="template" value={selectedCard} />

                                <div className="space-y-6">
                                    <div className="space-y-3">
                                        <SectionHeading>Start with your own prompt</SectionHeading>
                                        <CustomPromptCard
                                            selected={selectedCard === 'custom'}
                                            onSelect={() => handleCardSelect('custom')}
                                            customPrompt={customPrompt}
                                            onCustomPromptChange={setCustomPrompt}
                                        />
                                    </div>
                                    
                                    <div className="space-y-3">
                                        <SectionHeading>Or choose an example</SectionHeading>
                                        <TemplateCardsList
                                            selectedCard={selectedCard}
                                            onSelectCard={handleCardSelect}
                                        />
                                    </div>
                                </div>
                            </form>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
} 