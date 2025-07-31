'use client';

import { useState, useEffect } from "react";
import { useRouter } from 'next/navigation';
import { createProject } from "@/app/actions/project_actions";
import { PictureImg } from '@/components/ui/picture-img';

interface TemplatesSectionProps {}

export function TemplatesSection({}: TemplatesSectionProps) {
    const [templates, setTemplates] = useState<any[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [templatesError, setTemplatesError] = useState<string | null>(null);
    const router = useRouter();

    // Extract unique tools from template - using same approach as ToolkitCard
    const getUniqueTools = (template: any) => {
        if (!template.tools) return [];
        
        const uniqueToolsMap = new Map();
        template.tools.forEach((tool: any) => {
            if (!uniqueToolsMap.has(tool.name)) {
                // Include all tools, following the same pattern as Composio toolkit cards
                const toolData = {
                    name: tool.name,
                    isComposio: tool.isComposio,
                    isLibrary: tool.isLibrary,
                    logo: tool.isComposio && tool.composioData?.logo ? tool.composioData.logo : null,
                };
                
                uniqueToolsMap.set(tool.name, toolData);
            }
        });
        
        return Array.from(uniqueToolsMap.values()).filter(tool => tool.logo); // Only show tools with logos like ToolkitCard
    };

    const fetchTemplates = async () => {
        setTemplatesLoading(true);
        setTemplatesError(null);
        try {
            const response = await fetch('https://dev.rowboatlabs.com/api/templates');
            if (!response.ok) {
                throw new Error('Failed to fetch templates');
            }
            const data = await response.json();
            
            // Convert the object structure to an array of templates
            const templatesArray = Object.entries(data)
                .filter(([key]) => key !== 'default') // Exclude the default template
                .map(([key, template]: [string, any]) => ({
                    id: key,
                    ...template
                }));
            
            setTemplates(templatesArray);
        } catch (error) {
            console.error('Error fetching templates:', error);
            setTemplatesError(error instanceof Error ? error.message : 'Failed to load templates');
        } finally {
            setTemplatesLoading(false);
        }
    };

    // Handle template selection
    const handleTemplateSelect = async (templateId: string, templateName: string) => {
        try {
            const formData = new FormData();
            formData.append('name', templateName);
            formData.append('template', templateId);
            const response = await createProject(formData);
            if ('id' in response) {
                router.push(`/projects/${response.id}/workflow`);
            }
        } catch (error) {
            console.error('Error creating project from template:', error);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    return (
        <div className="h-screen flex flex-col px-8 py-8 overflow-hidden">
            <div className="max-w-7xl mx-auto w-full flex flex-col h-full">
                <div className="px-6 pb-4">
                    <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                        Pre-built agents
                    </h2>
                </div>
                <div className="px-6 flex-1 overflow-hidden">
                        {templatesLoading ? (
                            <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
                                Loading templates...
                            </div>
                        ) : templatesError ? (
                            <div className="flex items-center justify-center h-full text-sm text-red-500 dark:text-red-400">
                                Error: {templatesError}
                            </div>
                        ) : templates.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">
                                No templates available
                            </div>
                        ) : (
                            <div className="h-full overflow-y-auto">
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-4">
                                    {templates.map((template) => (
                                    <button
                                        key={template.id}
                                        onClick={() => handleTemplateSelect(template.id, template.name)}
                                        className="block p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all group hover:shadow-md text-left"
                                    >
                                        <div className="space-y-2">
                                            <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                                                {template.name}
                                            </div>
                                            <div className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                                                {template.description}
                                            </div>
                                            
                                            {/* Tool logos */}
                                            {(() => {
                                                const tools = getUniqueTools(template);
                                                return tools.length > 0 && (
                                                    <div className="flex items-center gap-2 mt-2">
                                                        <div className="text-xs text-gray-400 dark:text-gray-500">
                                                            Tools:
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            {tools.slice(0, 4).map((tool) => (
                                                                tool.logo && (
                                                                    <PictureImg
                                                                        key={tool.name}
                                                                        src={tool.logo}
                                                                        alt={`${tool.name} logo`}
                                                                        className="w-4 h-4 rounded-sm object-cover flex-shrink-0"
                                                                        title={tool.name}
                                                                    />
                                                                )
                                                            ))}
                                                            {tools.length > 4 && (
                                                                <span className="text-xs text-gray-400 dark:text-gray-500">
                                                                    +{tools.length - 4}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            
                                            <div className="flex items-center justify-between mt-2">
                                                <div className="text-xs text-gray-400 dark:text-gray-500">
                                                </div>
                                                <div className="w-2 h-2 rounded-full bg-blue-500 opacity-75"></div>
                                            </div>
                                        </div>
                                    </button>
                                    ))}
                                </div>
                            </div>
                        )}
                </div>
            </div>
        </div>
    );
}