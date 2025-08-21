interface AtMentionItem {
    id: string;
    value: string;
    [key: string]: string;  // Add index signature to allow any string key
}

interface CreateAtMentionsProps {
    agents: any[];
    prompts: any[];
    tools: any[];
    pipelines?: any[];
    currentAgentName?: string;
    currentAgent?: any; // Add current agent object to know its outputVisibility
}

export function createAtMentions({ agents, prompts, tools, pipelines = [], currentAgentName, currentAgent }: CreateAtMentionsProps): AtMentionItem[] {
    const atMentions: AtMentionItem[] = [];

    // For pipeline agents, only add tools and prompts - no agents or pipelines
    const isCurrentAgentPipeline = currentAgent?.type === 'pipeline';

    // Add agents (excluding pipeline agents and disabled agents)
    // Also exclude ALL agents if current agent is a pipeline agent
    if (!isCurrentAgentPipeline) {
        for (const a of agents) {
            if (a.disabled || a.name === currentAgentName || a.type === 'pipeline') {
                continue;
            }
            const id = `agent:${a.name}`;
            atMentions.push({
                id,
                value: id,
                label: `Agent: ${a.name}`,
                denotationChar: "@",    // Add required properties for Match type
                link: id,
                target: "_self"
            });
        }
    }

    // Add pipelines (only if current agent is not a pipeline agent)
    if (!isCurrentAgentPipeline) {
        for (const pipeline of pipelines) {
            const id = `pipeline:${pipeline.name}`;
            atMentions.push({
                id,
                value: id,
                label: `Pipeline: ${pipeline.name}`,
                denotationChar: "@",
                link: id,
                target: "_self"
            });
        }
    }

    // Add prompts (always allowed)
    for (const prompt of prompts) {
        // Use 'variable' for base_prompt types, 'prompt' for others
        const isVariable = prompt.type === 'base_prompt';
        const type = isVariable ? 'variable' : 'prompt';
        const label = isVariable ? 'Variable' : 'Prompt';
        const id = `${type}:${prompt.name}`;
        atMentions.push({
            id,
            value: id,
            label: `${label}: ${prompt.name}`,
            denotationChar: "@",
            link: id,
            target: "_self"
        });
    }

    // Add tools (always allowed)
    for (const tool of tools) {
        const id = `tool:${tool.name}`;
        atMentions.push({
            id,
            value: id,
            label: `Tool: ${tool.name}`,
            denotationChar: "@",
            link: id,
            target: "_self"
        });
    }

    return atMentions;
} 