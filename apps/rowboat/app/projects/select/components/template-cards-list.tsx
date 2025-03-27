import { templates, starting_copilot_prompts } from "@/app/lib/project_templates";
import { TemplateCard } from "./template-card";
import { WorkflowTemplate } from "@/lib/types/workflow_types";
import { z } from "zod";

type Template = z.infer<typeof WorkflowTemplate> & {
    id: string;
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
                    template={{ ...template, id }}
                    selected={selectedCard?.id === id}
                    onSelect={() => onSelectCard({ ...template, id })}
                />
            ))}
            
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
    );
}
