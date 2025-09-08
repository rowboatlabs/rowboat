import { WorkflowTemplate } from "./types/workflow_types";
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || "gpt-4.1";

// Function to load prebuilt cards from JSON files
function loadTemplatesFromFiles(): { [key: string]: z.infer<typeof WorkflowTemplate> } {
    const templatesDir = path.join(__dirname, 'prebuilt-cards');
    const templates: { [key: string]: z.infer<typeof WorkflowTemplate> } = {};
    
    // Add default template
    templates['default'] = {
        name: 'Blank Template',
        description: 'A blank canvas to build your agents.',
        startAgent: "Example Agent",
        agents: [
            {
                name: "Example Agent",
                type: "conversation",
                description: "An example agent",
                instructions: "## 🧑‍ Role:\nYou are an helpful customer support assistant\n\n---\n## ⚙️ Steps to Follow:\n1. Ask the user what they would like help with\n2. Ask the user for their email address and let them know someone will contact them soon.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Asking the user their issue\n- Getting their email\n\n❌ Out of Scope:\n- Questions unrelated to customer support\n- If a question is out of scope, politely inform the user and avoid providing an answer.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- ask user their issue\n\n❌ Don'ts:\n- don't ask user any other detail than email",
                model: DEFAULT_MODEL,
                toggleAble: true,
                ragReturnType: "chunks",
                ragK: 3,
                controlType: "retain",
                outputVisibility: "user_facing",
            },
        ],
        prompts: [],
        tools: [],
    };
    
    try {
        // Check if prebuilt cards directory exists
        if (fs.existsSync(templatesDir)) {
            const files = fs.readdirSync(templatesDir);
            
            // Load each JSON file
            files.forEach(file => {
                if (path.extname(file) === '.json') {
                    try {
                        const filePath = path.join(templatesDir, file);
                        const fileContent = fs.readFileSync(filePath, 'utf-8');
                        const templateData = JSON.parse(fileContent);
                        
                        // Use filename without extension as template key
                        const templateKey = path.basename(file, '.json');
                        
                        // Validate template structure (optional - you can add more validation)
                        if (templateData.agents && Array.isArray(templateData.agents)) {
                            templates[templateKey] = templateData;
                        }
                    } catch (error) {
                        console.warn(`Failed to load prebuilt card ${file}:`, error);
                    }
                }
            });
        }
    } catch (error) {
        console.warn('Failed to load prebuilt cards from directory:', error);
    }
    
    return templates;
}

export const templates: { [key: string]: z.infer<typeof WorkflowTemplate> } = loadTemplatesFromFiles();

// Note: Prebuilt cards are now loaded from app/lib/prebuilt-cards/ directory
// starting_copilot_prompts has been removed as it was unused