import { templates, starting_copilot_prompts } from "@/app/lib/project_templates";
import { TemplateCard } from "./template-card";
import { WorkflowTemplate } from "@/types/workflow_types";
import { z } from "zod";

// Use the existing template type but make id optional
type Template = z.infer<typeof WorkflowTemplate> & {
    id?: string;
    prompt?: string;
};

type TemplateCardsListProps = {
    selectedCard: 'custom' | Template;
    onSelectCard: (template: Template) => void;
};

export function TemplateCardsList({ selectedCard, onSelectCard }: TemplateCardsListProps) {
    return (
        <div className="grid grid-cols-2 gap-4">
            {Object.entries(templates).map(([id, template]) => (
                <TemplateCard
                    key={id}
                    templateKey={id}
                    template={template}  // Remove the type assertion
                    selected={selectedCard !== 'custom' && selectedCard.id === id}
                    onSelect={() => onSelectCard({ ...template, id })}
                />
            ))}
            
            {Object.entries(starting_copilot_prompts).map(([name, prompt]) => {
                // Create a template-compatible object
                const promptTemplate: Template = {
                    name,
                    description: prompt,
                    prompt,
                    id: name.toLowerCase(),
                    agents: [],  // Required by WorkflowTemplate
                    prompts: [], // Required by WorkflowTemplate
                    tools: [],   // Required by WorkflowTemplate
                    startAgent: ''  // Required by WorkflowTemplate
                };
                
                return (
                    <TemplateCard
                        key={name}
                        templateKey={name.toLowerCase()}
                        template={promptTemplate}
                        selected={selectedCard !== 'custom' && selectedCard.id === name.toLowerCase()}
                        onSelect={() => onSelectCard(promptTemplate)}
                    />
                );
            })}
        </div>
    );
}
