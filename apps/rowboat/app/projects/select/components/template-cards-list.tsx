import { templates, starting_copilot_prompts } from "@/app/lib/project_templates";
import { TemplateCard } from "./template-card";
import { CustomPromptCard } from "./custom-prompt-card";
import { WorkflowTemplate } from "@/lib/types/workflow_types";
import { z } from "zod";

type Template = z.infer<typeof WorkflowTemplate> & {
    id: string;
    prompt?: string;
};

type TemplateCardsListProps = {
    selectedCard: 'custom' | Template;
    onSelectCard: (template: Template | 'custom') => void;
    customPrompt: string;
    onCustomPromptChange: (prompt: string) => void;
};

export function TemplateCardsList({ 
    selectedCard, 
    onSelectCard,
    customPrompt,
    onCustomPromptChange
}: TemplateCardsListProps) {
    return (
        <div className="space-y-6">
            {/* Custom Prompt Card at the top */}
            <CustomPromptCard
                selected={selectedCard === 'custom'}
                onSelect={() => onSelectCard('custom')}
                customPrompt={customPrompt}
                onCustomPromptChange={onCustomPromptChange}
            />
            
            {/* Grid of template cards */}
            <div className="grid grid-cols-2 gap-4">
                {/* Templates first */}
                {Object.entries(templates).map(([id, template]) => (
                    <TemplateCard
                        key={id}
                        template={{ ...template, id }}
                        selected={selectedCard?.id === id}
                        onSelect={() => onSelectCard({ ...template, id })}
                    />
                ))}
                
                {/* Starting prompts second */}
                {Object.entries(starting_copilot_prompts).map(([name, prompt]) => (
                    <TemplateCard
                        key={name}
                        template={{
                            id: name.toLowerCase(),
                            name,
                            description: prompt,
                            prompt
                        }}
                        selected={selectedCard?.id === name.toLowerCase()}
                        onSelect={() => onSelectCard({
                            id: name.toLowerCase(),
                            name,
                            description: prompt,
                            prompt
                        })}
                    />
                ))}
            </div>
        </div>
    );
}
