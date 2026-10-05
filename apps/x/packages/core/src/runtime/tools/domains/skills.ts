// Builtin tools: skills domain. skill-manage is the agent's only write path
// into skills (2026-10-05): it creates, edits and deletes skills the agent
// wrote, and keeps learned notes on top of every other skill. Ownership and
// validation live in assembly/skills/agent-skills.ts.

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";
import {
    AgentSkillError,
    createAgentSkill,
    deleteAgentSkill,
    listAgentSkills,
    patchAgentSkill,
    updateAgentSkill,
    writeLearnedNotes,
    type ExistingSkillLookup,
} from "../../assembly/skills/agent-skills.js";
import { isSkillIdTaken, refreshDiskSkills } from "../../assembly/skills/index.js";

const SKILL_ACTIONS = ["list", "create", "update", "patch", "delete", "write-notes"] as const;

const lookup: ExistingSkillLookup = {
    isTaken: isSkillIdTaken,
    exists: isSkillIdTaken,
};

// The watcher would pick the change up after its debounce, but a skill made
// in this turn should be loadable in this turn. Dynamic import: the copilot
// instructions module sits above the tool catalog in the import graph.
async function reloadSkills(): Promise<void> {
    refreshDiskSkills();
    const { invalidateCopilotInstructionsCache } = await import("../../assembly/copilot/instructions.js");
    invalidateCopilotInstructionsCache();
}

function required(value: string | undefined, field: string, action: string): string {
    if (value === undefined) throw new AgentSkillError(`Action '${action}' needs '${field}'.`);
    return value;
}

export const skillTools: z.infer<typeof BuiltinToolsSchema> = {
    'skill-manage': {
        // Same trust level as save-to-memory: local, user-visible, reversible
        // writes that never attach tools. Ownership is enforced in the store.
        permission: "none",
        description: "Create, edit and delete skills you created, or keep learned notes on top of any other skill. Actions: list (your skills and notes); create (name, description, body); update (name, description and/or body); patch (name, oldString, newString — exact single match in the body); delete (name — archived, restorable); write-notes (skill, notes — replaces the whole note set appended to that skill when it loads; empty notes clears them). You can only change skills you created and notes you wrote; anything the user wrote or edited is refused.",
        inputSchema: z.object({
            action: z.enum(SKILL_ACTIONS).describe("What to do."),
            name: z.string().optional().describe("Skill name for create/update/patch/delete: lowercase-hyphenated, naming the class of task (e.g. 'investor-update-emails')."),
            description: z.string().optional().describe("create/update: one line saying when to load the skill."),
            body: z.string().optional().describe("create/update: the skill's markdown guidance (no frontmatter)."),
            oldString: z.string().optional().describe("patch: exact text in the body to replace; must match once."),
            newString: z.string().optional().describe("patch: replacement text."),
            skill: z.string().optional().describe("write-notes: id of the skill the notes sit on (e.g. 'create-presentations')."),
            notes: z.string().optional().describe("write-notes: the complete markdown note list for that skill."),
        }),
        execute: async (input: {
            action: typeof SKILL_ACTIONS[number];
            name?: string;
            description?: string;
            body?: string;
            oldString?: string;
            newString?: string;
            skill?: string;
            notes?: string;
        }) => {
            try {
                const { action } = input;
                if (action === "list") {
                    return { success: true, ...listAgentSkills() };
                }
                let result: Record<string, unknown>;
                switch (action) {
                    case "create":
                        result = createAgentSkill({
                            name: required(input.name, "name", action),
                            description: required(input.description, "description", action),
                            body: required(input.body, "body", action),
                        }, lookup);
                        break;
                    case "update":
                        result = updateAgentSkill({
                            name: required(input.name, "name", action),
                            description: input.description,
                            body: input.body,
                        });
                        break;
                    case "patch":
                        result = patchAgentSkill({
                            name: required(input.name, "name", action),
                            oldString: required(input.oldString, "oldString", action),
                            newString: required(input.newString, "newString", action),
                        });
                        break;
                    case "delete":
                        result = deleteAgentSkill({ name: required(input.name, "name", action) });
                        break;
                    case "write-notes":
                        result = writeLearnedNotes({
                            skill: required(input.skill, "skill", action),
                            notes: required(input.notes, "notes", action),
                        }, lookup);
                        break;
                }
                await reloadSkills();
                return { success: true, action, ...result };
            } catch (err) {
                if (err instanceof AgentSkillError) {
                    return { success: false, error: err.message };
                }
                throw err;
            }
        },
    },
};
