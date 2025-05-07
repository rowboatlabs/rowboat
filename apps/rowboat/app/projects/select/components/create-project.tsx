'use client';

import { useEffect, useState, useRef } from "react";
import { createProject, createProjectFromPrompt } from "@/app/actions/project_actions";
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { starting_copilot_prompts } from "@/app/lib/project_templates";
import { SectionHeading } from "@/components/ui/section-heading";
import { Textarea } from "@/components/ui/textarea";
import { Submit } from "./submit-button";
import { Button } from "@/components/ui/button";
import { FolderOpenIcon, SparklesIcon, LightBulbIcon, PlayIcon, CommandLineIcon, ArrowPathIcon, CheckCircleIcon, DocumentChartBarIcon, LanguageIcon, ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { USE_MULTIPLE_PROJECTS } from "@/app/lib/feature_flags";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const TabType = {
    Describe: 'describe',
    Blank: 'blank',
    // Example: 'example' // No longer needed with ChatGPT style
} as const;

type TabState = typeof TabType[keyof typeof TabType];

// const isNotBlankTemplate = (tab: TabState): boolean => tab !== 'blank'; // Might be unused

// Removed tabStyles, activeTabStyles, inactiveTabStyles as tabs are removed

const largeSectionHeaderStyles = clsx(
    "text-3xl sm:text-5xl font-semibold text-center mb-8 sm:mb-10", // Adjusted margins
    "text-gray-900 dark:text-gray-100"
);

const mainTextareaStyles = clsx(
    "w-full",
    "min-h-[140px] sm:min-h-[160px]", // Slightly adjusted height
    "rounded-2xl p-4 text-base sm:text-lg", // Adjusted padding and text size
    "bg-white dark:bg-neutral-900",
    "border border-gray-300 dark:border-neutral-700",
    "focus-visible:outline-none focus-visible:border-emerald-500 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:focus-visible:ring-emerald-500/30",
    "placeholder:text-gray-400 dark:placeholder:text-gray-500",
    "transition-all duration-200"
);

const emptyTextareaStyles = clsx(
    // "animate-glow",
    // "border-emerald-500/40 dark:border-emerald-400/40",
    // "shadow-[0_0_8px_1px_rgba(99,102,241,0.2)] dark:shadow-[0_0_8px_1px_rgba(129,140,248,0.2)]"
);

// Mock data for Trending Agents
const mockTrendingAgents = [
    { id: 'trend1', title: 'Аналитик данных', description: 'AI-ассистент для анализа таблиц, поиска инсайтов и построения графиков.', Icon: DocumentChartBarIcon, prompt: 'Проанализируй предоставленные данные CSV, выяви ключевые тенденции и создай сводный отчет с визуализациями.' },
    { id: 'trend2', title: 'Email Помощник', description: 'Этот AI-ассистент поможет писать и сортировать электронные письма.', Icon: SparklesIcon, prompt: 'Составь вежливое письмо-напоминание клиенту, который не ответил на предыдущее предложение. Письмо должно быть кратким и дружелюбным.' },
    { id: 'trend3', title: 'Генератор идей', description: 'AI-ассистент для мозгового штурма и создания креативных концепций.', Icon: LightBulbIcon, prompt: 'Придумай 5 креативных идей для постов в блог о будущем возобновляемой энергии.' },
    { id: 'trend4', title: 'Переводчик документов', description: 'Быстро и точно переведет ваши документы на разные языки.', Icon: LanguageIcon, prompt: 'Переведи следующий текст с английского на русский, сохраняя форматирование: [вставить текст].' },
    { id: 'trend5', title: 'Служба поддержки', description: 'Ответит на частые вопросы клиентов о вашем продукте.', Icon: ChatBubbleLeftRightIcon, prompt: 'Ответь на вопрос клиента о процедуре возврата товара согласно нашей политике.' },
];

// Consolidate suggestions - Text only now
const chatGptStyleSuggestions = [
    { id: 'sugg1', title: 'Аналитик данных', prompt: mockTrendingAgents.find(a => a.title === 'Аналитик данных')?.prompt || 'Проанализируй предоставленные данные CSV, выяви ключевые тенденции и создай сводный отчет с визуализациями.'}, 
    { id: 'sugg2', title: 'Email Помощник', prompt: mockTrendingAgents.find(a => a.title === 'Email Помощник')?.prompt || 'Составь вежливое письмо-напоминание клиенту, который не ответил на предыдущее предложение. Письмо должно быть кратким и дружелюбным.'}, 
    { id: 'sugg3', title: 'Генератор идей', prompt: mockTrendingAgents.find(a => a.title === 'Генератор идей')?.prompt || 'Придумай 5 креативных идей для постов в блог о будущем возобновляемой энергии.'}, 
    ...Object.entries(starting_copilot_prompts).slice(0, 2).map(([key, promptText], index) => ({
        id: `sugg_tpl_${index}`,
        title: key.replace(/_/g, ' '),
        prompt: promptText as string,
    }))
].slice(0, 5); // Ensure 5 suggestions

interface CreateProjectProps {
    defaultName: string;
    onOpenProjectPane: () => void;
    isProjectPaneOpen: boolean;
}

export function CreateProject({ defaultName, onOpenProjectPane, isProjectPaneOpen }: CreateProjectProps) {
    // const [selectedTab, setSelectedTab] = useState<TabState>(TabType.Describe); // Removed
    // const [isExamplesDropdownOpen, setIsExamplesDropdownOpen] = useState(false); // Removed
    // const dropdownRef = useRef<HTMLDivElement>(null); // Removed
    const [customPrompt, setCustomPrompt] = useState("");
    const [name, setName] = useState(defaultName);
    const [promptError, setPromptError] = useState<string | null>(null);
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [highlightedTemplate, setHighlightedTemplate] = useState<string | null>(null);

    useEffect(() => {
        setName(defaultName);
    }, [defaultName]);

    // }, [isExamplesDropdownOpen]); // Removed

    const handleExampleSelect = (examplePrompt: string, key: string) => {
        setCustomPrompt(examplePrompt);
        setHighlightedTemplate(key);
        const promptTextarea = document.getElementById("prompt-textarea");
        if (promptTextarea) {
            promptTextarea.focus();
            const textareaRect = promptTextarea.getBoundingClientRect();
            if (textareaRect.top < 0 || textareaRect.bottom > window.innerHeight) {
                promptTextarea.scrollIntoView({ behavior: "smooth", block: "center" });
            } else {
                // If already in view, do not scroll to top, let user see the text they selected
            }
        } 
        setTimeout(() => setHighlightedTemplate(null), 2000);
    };

    async function handleSubmit(formDataOrValues: FormData | { name: string; prompt: string }) {
        setPromptError(null);
        setIsCreating(true);
        let currentName: string;
        let currentPrompt: string;

        if (formDataOrValues instanceof FormData) {
            currentName = formDataOrValues.get('name') as string || name;
            currentPrompt = formDataOrValues.get('prompt') as string || customPrompt;
        } else {
            currentName = formDataOrValues.name;
            currentPrompt = formDataOrValues.prompt;
        }

        if (!currentPrompt.trim()) {
            setPromptError("Дружище, без описания никак. Расскажи, что к чему, или выбери шаблон.");
            setIsCreating(false);
            return;
        }

        try {
            const newFormData = new FormData();
            newFormData.append('name', currentName);
            newFormData.append('prompt', currentPrompt);
            const response = await createProjectFromPrompt(newFormData);
            
            if (response?.id && currentPrompt) {
                localStorage.setItem(`project_prompt_${response.id}`, currentPrompt);
            }

            if (!response?.id) {
                throw new Error('Project creation failed');
            }
            router.push(`/projects/${response.id}/workflow`);
        } catch (error) {
            console.error('Error creating project:', error);
            setPromptError(`Ой, не вышло создать проект :( Вот что случилось: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setIsCreating(false);
        }
    }

    return (
        <div className={clsx(
            "flex flex-col items-center min-h-screen py-16 sm:py-24 px-4 md:px-8", // Adjusted padding
            "w-full",
            "bg-white dark:bg-black"
        )}>
            {USE_MULTIPLE_PROJECTS && !isProjectPaneOpen && (
                <div className="absolute top-6 right-6 sm:top-8 sm:right-8 z-20">
                    <Button
                        onClick={onOpenProjectPane}
                        variant="secondary"
                        size="md"
                        className={clsx(
                            "bg-gray-50 hover:bg-gray-100 dark:bg-neutral-800 dark:hover:bg-neutral-700",
                            "text-gray-700 dark:text-gray-300",
                            "border border-gray-300 dark:border-neutral-700 hover:border-gray-400 dark:hover:border-neutral-600",
                            "hover:text-gray-900 dark:hover:text-gray-100",
                            "rounded-lg shadow-none transition-all duration-200"
                        )}
                    >
                        <span className="flex flex-row items-center justify-center">
                            <FolderOpenIcon className="w-5 h-5 mr-2" />
                            Мои проекты
                        </span>
                    </Button>
                </div>
            )}

            <section className={clsx(
                "w-full max-w-2xl text-center mb-12 sm:mb-16" // Adjusted bottom margin
            )}>
                <h1 className={largeSectionHeaderStyles}>
                    Создай своего <span className="text-emerald-600 dark:text-emerald-500">AI-ассистента</span>. <br className="hidden sm:block" /> Начни с идеи – остальное здесь!
                </h1>
                
                {/* Suggestions Area - Moved above the form input */}
                <div className="w-full max-w-2xl mb-6 text-center">
                    <div className="flex flex-wrap gap-2 justify-center">
                        {chatGptStyleSuggestions.map(suggestion => (
                            <Button
                                key={suggestion.id}
                                onClick={() => handleExampleSelect(suggestion.prompt, suggestion.id)}
                                className={clsx(
                                    "font-normal text-sm rounded-full transition-colors",
                                    "py-1.5 px-4",
                                    "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 hover:border-gray-300",
                                    "dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-gray-300 dark:border-neutral-700 dark:hover:border-neutral-600",
                                    highlightedTemplate === suggestion.id && "ring-2 ring-emerald-500 dark:ring-emerald-500",
                                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                                )}
                            >
                                {suggestion.title} 
                            </Button>
                        ))}
                    </div>
                </div>
                
                <form
                    id="create-project-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSubmit({name: name, prompt: customPrompt});
                    }}
                    className="space-y-6 w-full" // Adjusted spacing
                >
                    <div className="relative w-full"> {/* Wrapper for Textarea and submit button */}
                        <Textarea
                            id="prompt-textarea"
                            name="prompt"
                            value={customPrompt}
                            onChange={(e) => {
                                setCustomPrompt(e.target.value);
                                if (promptError) setPromptError(null);
                            }}
                            placeholder="Введите свой запрос или выберите подсказку..." // New placeholder
                            className={clsx(mainTextareaStyles)}
                            rows={5} 
                            disabled={isCreating}
                        />
                    </div>
                    {promptError && (
                        <p className="text-red-500 dark:text-red-400 text-sm mt-2 text-left font-medium">{promptError}</p>
                    )}

                    {/* Restored larger submit button here */}
                    <div className="mt-8 flex justify-center">
                        <Button
                            type="submit"
                            variant="secondary"
                            className={clsx(
                                "group rounded-lg px-8 py-3 font-semibold text-base transition-all duration-200 active:scale-[0.98]",
                                "bg-gray-50 hover:bg-gray-100 active:bg-gray-200",
                                "text-gray-700 hover:text-gray-900",
                                "border border-gray-300 hover:border-gray-400",
                                "dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:active:bg-neutral-600",
                                "dark:text-gray-300 dark:hover:text-gray-100",
                                "dark:border-neutral-700 dark:hover:border-neutral-600",
                                "shadow-none",
                                isCreating && "opacity-70 cursor-not-allowed"
                            )}
                            disabled={isCreating}
                        >
                            <span className="flex flex-row items-center justify-center w-full">
                                {isCreating ? (
                                    <span className="mr-3">
                                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"> {/* Removed text-white */}
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                    </span>
                                ) : (
                                    <span className="mr-2">
                                        <PlayIcon className="w-5 h-5 transition-transform group-hover:scale-110"/>
                                    </span>
                                )}
                                <span>
                                    Поехали!
                                    <span className="hidden md:inline ml-2 text-xs opacity-70 group-hover:opacity-90">⌘+↵</span>
                                </span>
                            </span>
                        </Button>
                    </div>

                    {USE_MULTIPLE_PROJECTS && (
                        <div className="space-y-3 pt-4 text-left"> 
                            <label htmlFor="project-name" className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                Как назовём проект? (можно и потом)
                            </label>
                            <Input
                                id="project-name"
                                name="name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className={clsx(
                                    "w-full rounded-lg p-3 text-base",
                                    "bg-white dark:bg-neutral-900",
                                    "border border-gray-300 dark:border-neutral-700",
                                    "focus-visible:outline-none focus-visible:border-emerald-500 dark:focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:focus-visible:ring-emerald-500/30",
                                    "placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-none"
                                )}
                                placeholder={defaultName}
                                disabled={isCreating}
                            />
                        </div>
                    )}
                </form>
            </section>

            {/* Trending Agents Section - REMOVED */}
            {/* Agent Templates Section - REMOVED */}
        </div>
    );
}
