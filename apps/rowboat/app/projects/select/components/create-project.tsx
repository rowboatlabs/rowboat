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
    Example: 'example'
} as const;

type TabState = typeof TabType[keyof typeof TabType];

const isNotBlankTemplate = (tab: TabState): boolean => tab !== 'blank';

const tabStyles = clsx(
    "px-4 py-2 text-sm font-medium",
    "rounded-lg",
    "focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:focus:ring-emerald-400/20",
    "transition-colors duration-150"
);

const activeTabStyles = clsx(
    "bg-white dark:bg-gray-800",
    "text-gray-900 dark:text-gray-100",
    "shadow-sm",
    "border border-gray-200 dark:border-gray-700"
);

const inactiveTabStyles = clsx(
    "text-gray-600 dark:text-gray-400",
    "hover:bg-gray-50 dark:hover:bg-gray-750"
);

const largeSectionHeaderStyles = clsx(
    "text-3xl sm:text-4xl font-bold text-center mb-10 sm:mb-12",
    "text-gray-900 dark:text-gray-100"
);

const mainTextareaStyles = clsx(
    "w-full",
    "min-h-[120px] sm:min-h-[140px]",
    "rounded-xl p-4 text-lg",
    "bg-white dark:bg-neutral-900",
    "border border-gray-200 dark:border-neutral-800",
    "focus-visible:outline-none focus-visible:border-emerald-500 dark:focus-visible:border-emerald-500 focus-visible:border-2",
    "focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.15)] dark:focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.2)]",
    "placeholder:text-gray-400 dark:placeholder:text-gray-500",
    "transition-all duration-200",
    "shadow-sm"
);

const emptyTextareaStyles = clsx(
    // "animate-glow",
    // "border-emerald-500/40 dark:border-emerald-400/40",
    // "shadow-[0_0_8px_1px_rgba(99,102,241,0.2)] dark:shadow-[0_0_8px_1px_rgba(129,140,248,0.2)]"
);

const sectionTitleStyles = clsx(
    "text-2xl sm:text-3xl font-semibold mb-10 text-gray-800 dark:text-gray-100 text-left w-full"
);

const iconPlaceholderStyles = clsx(
    "w-12 h-12 p-3 bg-slate-100 dark:bg-slate-700/60 rounded-xl text-emerald-600 dark:text-emerald-400 mb-4 shadow-sm hover:shadow-md transition-shadow duration-200"
);

// Mock data for Trending Agents
const mockTrendingAgents = [
    { id: 'trend1', title: 'Аналитик данных', description: 'AI-ассистент для анализа таблиц, поиска инсайтов и построения графиков.', Icon: DocumentChartBarIcon, prompt: 'Проанализируй предоставленные данные CSV, выяви ключевые тенденции и создай сводный отчет с визуализациями.' },
    { id: 'trend2', title: 'Email Помощник', description: 'Этот AI-ассистент поможет писать и сортировать электронные письма.', Icon: SparklesIcon, prompt: 'Составь вежливое письмо-напоминание клиенту, который не ответил на предыдущее предложение. Письмо должно быть кратким и дружелюбным.' },
    { id: 'trend3', title: 'Генератор идей', description: 'AI-ассистент для мозгового штурма и создания креативных концепций.', Icon: LightBulbIcon, prompt: 'Придумай 5 креативных идей для постов в блог о будущем возобновляемой энергии.' },
    { id: 'trend4', title: 'Переводчик документов', description: 'Быстро и точно переведет ваши документы на разные языки.', Icon: LanguageIcon, prompt: 'Переведи следующий текст с английского на русский, сохраняя форматирование: [вставить текст].' },
    { id: 'trend5', title: 'Служба поддержки', description: 'Ответит на частые вопросы клиентов о вашем продукте.', Icon: ChatBubbleLeftRightIcon, prompt: 'Ответь на вопрос клиента о процедуре возврата товара согласно нашей политике.' },
];

interface CreateProjectProps {
    defaultName: string;
    onOpenProjectPane: () => void;
    isProjectPaneOpen: boolean;
}

export function CreateProject({ defaultName, onOpenProjectPane, isProjectPaneOpen }: CreateProjectProps) {
    const [selectedTab, setSelectedTab] = useState<TabState>(TabType.Describe);
    const [isExamplesDropdownOpen, setIsExamplesDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [customPrompt, setCustomPrompt] = useState("");
    const [name, setName] = useState(defaultName);
    const [promptError, setPromptError] = useState<string | null>(null);
    const router = useRouter();
    const [isCreating, setIsCreating] = useState(false);
    const [highlightedTemplate, setHighlightedTemplate] = useState<string | null>(null);

    useEffect(() => {
        setName(defaultName);
    }, [defaultName]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsExamplesDropdownOpen(false);
            }
        }

        if (isExamplesDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isExamplesDropdownOpen]);

    const handleTabChange = (tab: TabState) => {
        setSelectedTab(tab);
        setIsExamplesDropdownOpen(false);

        if (tab === TabType.Blank) {
            setCustomPrompt('');
        } else if (tab === TabType.Describe) {
            setCustomPrompt('');
        }
    };

    const handleBlankTemplateClick = (e: React.MouseEvent) => {
        e.preventDefault();
        handleTabChange(TabType.Blank);
    };

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
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        } else {
            window.scrollTo({ top: 0, behavior: "smooth" });
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
            "flex flex-col items-center min-h-screen py-12 sm:py-16 px-4 md:px-8",
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
                            "text-gray-700 dark:text-gray-300 border-gray-300 dark:border-neutral-700",
                            "hover:border-gray-400 dark:hover:border-neutral-600 hover:text-gray-900 dark:hover:text-gray-100",
                            "rounded-lg shadow-sm hover:shadow-md transition-all duration-200"
                        )}
                    >
                        <FolderOpenIcon className="w-5 h-5 mr-2" />
                        Мои проекты
                    </Button>
                </div>
            )}

            <section className={clsx(
                "w-full max-w-2xl text-center mb-16 sm:mb-20"
            )}>
                <h1 className={largeSectionHeaderStyles}>
                    Создай своего <span className="text-emerald-600">AI-ассистента</span>. Начни с идеи – остальное здесь!
                </h1>
                
                <form
                    id="create-project-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleSubmit({name: name, prompt: customPrompt});
                    }}
                    className="space-y-8 w-full"
                >
                    <div className="relative">
                        <Textarea
                            id="prompt-textarea"
                            name="prompt"
                            value={customPrompt}
                            onChange={(e) => {
                                setCustomPrompt(e.target.value);
                                if (promptError) setPromptError(null);
                            }}
                            placeholder="Опиши задачи для своего AI-ассистента: например, отвечать на вопросы клиентов или анализировать данные."
                            className={clsx(
                                mainTextareaStyles
                            )}
                            rows={5}
                            disabled={isCreating}
                        />
                        <div className="mt-6 flex justify-center md:absolute md:bottom-5 md:right-5">
                            <Button
                                type="submit"
                                variant="primary"
                                size="lg"
                                className={clsx(
                                    "group bg-gray-900 hover:bg-gray-700 active:bg-gray-950 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700 dark:active:bg-emerald-800 shadow-lg hover:shadow-xl active:shadow-lg active:scale-[0.97] transition-all duration-200 rounded-xl px-8 py-3 font-semibold text-base",
                                    isCreating && "opacity-70 cursor-not-allowed"
                                )}
                                disabled={isCreating}
                            >
                                {isCreating ? (
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <PlayIcon className="w-5 h-5 mr-2 transition-transform group-hover:scale-110"/>
                                )}
                                Поехали!
                                <span className="hidden md:inline ml-2 text-xs opacity-70 group-hover:opacity-90">⌘+↵</span>
                            </Button>
                        </div>
                    </div>
                    {promptError && (
                        <p className="text-red-500 dark:text-red-400 text-sm mt-2 text-left font-medium">{promptError}</p>
                    )}

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
                                    "w-full rounded-xl p-3 text-base",
                                    "bg-white dark:bg-neutral-900",
                                    "border border-gray-200 dark:border-neutral-800",
                                    "focus-visible:outline-none focus-visible:border-emerald-500 dark:focus-visible:border-emerald-500 focus-visible:border-2",
                                    "focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.15)] dark:focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.2)]",
                                    "placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm"
                                )}
                                placeholder={defaultName}
                                disabled={isCreating}
                            />
                        </div>
                    )}
                </form>
            </section>

            {/* Trending Agents Section - Horizontal Scroll */}
            <section className="w-full max-w-full mb-16 sm:mb-20">
                <h2 className={clsx(sectionTitleStyles, "max-w-5xl mx-auto px-4 md:px-0")}>Популярные AI-ассистенты</h2>
                {/* Контейнер для горизонтального скролла */}
                <div className="flex overflow-x-auto space-x-6 pb-6 pt-3 px-4 md:px-8 scrollbar-hide">
                    {mockTrendingAgents.map(agent => (
                        <Card
                            key={agent.id}
                            className={clsx(
                                "min-w-[300px] sm:min-w-[320px] flex-shrink-0",
                                "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800",
                                "shadow-lg hover:shadow-xl dark:shadow-2xl dark:hover:shadow-2xl dark:shadow-black/20 dark:hover:shadow-black/40",
                                "transition-all duration-300 rounded-xl transform-gpu",
                                "hover:scale-[1.03] hover:-translate-y-1 cursor-pointer"
                            )}
                            onClick={() => handleExampleSelect(agent.prompt, agent.id)}
                        >
                            <CardHeader className="items-start text-left pt-6 px-6">
                                <div className={iconPlaceholderStyles}>
                                    <agent.Icon className="w-full h-full" />
                                </div>
                                <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{agent.title}</CardTitle>
                            </CardHeader>
                            <CardContent className="px-6 pb-6 pt-0">
                                <p className="text-sm text-gray-600 dark:text-slate-400 text-left leading-relaxed">{agent.description}</p>
                            </CardContent>
                        </Card>
                    ))}
                    {/* Добавляем пустой div в конец для визуального отступа */}
                    <div className="flex-shrink-0 w-1"></div>
                </div>
            </section>

            {/* Agent Templates Section - Horizontal Scroll */}
            {Object.keys(starting_copilot_prompts).length > 0 && (
                <section className="w-full max-w-full">
                    <h2 className={clsx(sectionTitleStyles, "max-w-5xl mx-auto px-4 md:px-0")}>Шаблоны AI-ассистентов: выбери основу для проекта.</h2>
                    {/* Контейнер для горизонтального скролла */}
                    <div className="flex overflow-x-auto space-x-6 pb-6 pt-3 px-4 md:px-8 scrollbar-hide">
                        {Object.entries(starting_copilot_prompts).map(([key, promptText]) => (
                            <Card
                                key={key}
                                className={clsx(
                                    "min-w-[300px] sm:min-w-[320px] flex-shrink-0",
                                    "bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800",
                                    "shadow-lg hover:shadow-xl dark:shadow-2xl dark:hover:shadow-2xl dark:shadow-black/20 dark:hover:shadow-black/40",
                                    "flex flex-col justify-between transition-all duration-300 rounded-xl transform-gpu",
                                    "hover:scale-[1.03] hover:-translate-y-1",
                                    highlightedTemplate === key && "ring-2 ring-emerald-500 ring-offset-4 dark:ring-offset-black shadow-2xl scale-[1.03] -translate-y-1"
                                )}
                            >
                                <div>
                                    <CardHeader className="items-start text-left pt-6 px-6">
                                        <div className={iconPlaceholderStyles}>
                                            <LightBulbIcon className="w-full h-full" />
                                        </div>
                                        <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{key.replace(/_/g, ' ')}</CardTitle>
                                    </CardHeader>
                                </div>
                                <CardFooter className="pt-4 mt-auto px-6 pb-6">
                                    <Button
                                        variant="secondary"
                                        onClick={() => handleExampleSelect(promptText as string, key)}
                                        className={clsx(
                                            "w-full border-emerald-500/70 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-500/70 dark:text-emerald-400 dark:hover:bg-emerald-900/40 dark:hover:text-emerald-300",
                                            "transition-all duration-200 rounded-lg font-medium py-2.5 text-sm",
                                            highlightedTemplate === key && "bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 border-emerald-600 dark:border-emerald-400"
                                        )}
                                    >
                                        {highlightedTemplate === key ? (
                                            <CheckCircleIcon className="w-5 h-5 mr-2 text-emerald-600 dark:text-emerald-400 transition-all duration-200 transform scale-110" />
                                        ) : (
                                            <SparklesIcon className="w-5 h-5 mr-2 text-emerald-500/80 opacity-70 group-hover:opacity-100 transition-opacity duration-200"/>
                                        )}
                                        Беру этот!
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                        <div className="flex-shrink-0 w-1"></div>
                    </div>
                </section>
            )}
        </div>
    );
}
