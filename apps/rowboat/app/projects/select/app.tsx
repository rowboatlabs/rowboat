'use client';

import { Project } from "../../lib/types/project_types";
import { useEffect, useState, useMemo } from "react";
import { z } from "zod";
import { listProjects, createProject, createProjectFromPrompt } from "../../actions/project_actions";
import { useRouter } from 'next/navigation';
import { tokens } from "@/app/styles/design-tokens";
import { cn } from "@heroui/react";
import { templates } from "@/app/lib/project_templates";
import { SectionHeading } from "@/components/ui/section-heading";
import { Textarea } from "@/components/ui/textarea";
import { Submit } from "./components/submit-button";
import Fuse from 'fuse.js';
import { TimeFilter } from "./components/search-input";
import { isToday, isThisWeek, isThisMonth } from "@/lib/utils/date";
import { TemplateCardsList } from "./components/template-cards-list";
import { SearchProjects } from "./components/search-projects";

interface SearchOptions {
    query: string;
    timeFilter: TimeFilter;
}

export default function App() {
    const router = useRouter();
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
                setProjects(projects);
                setIsLoading(false);
                const nextNumber = getNextUntitledNumber(projects);
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

    async function handleSubmit(formData: FormData) {
        if (selectedCard === 'custom') {
            console.log('Creating template project');
            return await createProject(formData);
        }

        if (selectedCard instanceof typeof templates[0]) {
            console.log('Starting prompt-based project creation');
            try {
                const newFormData = new FormData();
                const projectName = formData.get('name') as string;
                const promptText = selectedCard.prompt;
                
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault();
            handleSubmit(e as any);
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
                    <SearchProjects
                        projects={projects}
                        isLoading={isLoading}
                        searchOptions={searchOptions}
                        onSearchOptionsChange={setSearchOptions}
                    />

                    {/* Right side: Project Creation */}
                    <section className="card">
                        <div className="px-4 pt-4 flex justify-between items-start">
                            <div>
                                <SectionHeading
                                    subheading="Set up a new AI assistant"
                                >
                                    Create a new project
                                </SectionHeading>
                            </div>
                            <div className="pt-1">
                                <Submit />
                            </div>
                        </div>
                        
                        <form
                            action={handleSubmit}
                            onKeyDown={handleKeyDown}
                            className="px-4 pt-4 space-y-6"
                        >
                            <div>
                                <SectionHeading>Name your assistant</SectionHeading>
                                <Textarea
                                    required
                                    name="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="mt-1 min-h-[60px]"
                                    placeholder={defaultName}
                                />
                            </div>

                            <input type="hidden" name="template" value={selectedCard} />

                            <div className="space-y-4">
                                <TemplateCardsList
                                    selectedCard={selectedCard}
                                    onSelectCard={handleCardSelect}
                                    customPrompt={customPrompt}
                                    onCustomPromptChange={setCustomPrompt}
                                />
                            </div>
                        </form>
                    </section>
                </div>
            </div>
        </div>
    );
} 