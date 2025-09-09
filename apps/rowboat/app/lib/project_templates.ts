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
        startAgent: "",
        agents: [],
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