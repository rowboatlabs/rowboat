import { db } from "@/app/lib/mongodb";
import { prebuiltTemplates } from "@/app/lib/prebuilt-cards";

// Cache to track which templates have been seeded
const seededTemplates = new Set<string>();

// idempotent seed: creates library (prebuilt) templates in DB if missing
// Uses name+authorName match to avoid duplicates; tags include a stable prebuilt key
export async function ensureLibraryTemplatesSeeded(): Promise<void> {
    try {
        const collection = db.collection("assistant_templates");
        const now = new Date().toISOString();
        
        console.log('[PrebuiltTemplates] Starting template seeding...');

        const entries = Object.entries(prebuiltTemplates);
        for (const [prebuiltKey, tpl] of entries) {
            // minimal guard; only ingest valid workflow-like objects
            if (!(tpl as any)?.agents || !Array.isArray((tpl as any).agents)) continue;

            const name = (tpl as any).name || prebuiltKey;

            // check if already present (by name + authorName Rowboat and special tag)
            const existing = await collection.findOne({ name, authorName: "Rowboat", tags: { $in: [ `prebuilt:${prebuiltKey}`, "__library__" ] } });
            if (existing) {
                // Skip updating existing templates - we use original JSON at runtime
                continue;
            }

            const doc = {
                name,
                description: (tpl as any).description || "",
                category: (tpl as any).category || "Other",
                authorId: "rowboat-system",
                authorName: "Rowboat",
                authorEmail: undefined,
                isAnonymous: false,
                workflow: tpl as any,
                tags: ["__library__", `prebuilt:${prebuiltKey}`].filter(Boolean),
                publishedAt: now,
                lastUpdatedAt: now,
                downloadCount: 0,
                likeCount: 0,
                featured: false,
                isPublic: true,
                likes: [] as string[],
                copilotPrompt: (tpl as any).copilotPrompt || undefined,
                thumbnailUrl: undefined,
                source: 'library' as const,
            } as const;

            await collection.insertOne(doc as any);
        }
    } catch (err) {
        // best-effort seed; do not throw to avoid breaking requests
        console.error("ensureLibraryTemplatesSeeded error:", err);
    }
}

// Lazy seed: only seed a specific template when it's requested
export async function ensureTemplateSeeded(prebuiltKey: string): Promise<void> {
    if (seededTemplates.has(prebuiltKey)) {
        return; // Already seeded
    }

    const tpl = prebuiltTemplates[prebuiltKey as keyof typeof prebuiltTemplates];
    if (!tpl) {
        console.warn(`[PrebuiltTemplates] Template not found: ${prebuiltKey}`);
        return;
    }

    try {
        const collection = db.collection("assistant_templates");
        const now = new Date().toISOString();
        const name = (tpl as any).name || prebuiltKey;

        // Check if already exists
        const existing = await collection.findOne({ 
            name, 
            authorName: "Rowboat", 
            tags: { $in: [ `prebuilt:${prebuiltKey}`, "__library__" ] } 
        });

        if (existing) {
            // Update existing template with current model configuration
            const defaultModel = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4.1';
            const updatedWorkflow = JSON.parse(JSON.stringify(tpl));
            
            // Apply model transformation
            if (updatedWorkflow.agents && Array.isArray(updatedWorkflow.agents)) {
                updatedWorkflow.agents.forEach((agent: any) => {
                    if (agent.model === '') {
                        agent.model = defaultModel;
                    }
                });
            }

            await collection.updateOne(
                { _id: existing._id },
                { 
                    $set: {
                        workflow: updatedWorkflow,
                        lastUpdatedAt: now,
                    }
                }
            );
            console.log(`[PrebuiltTemplates] Updated template: ${name}`);
        } else {
            // Create new template with model transformation
            const defaultModel = process.env.PROVIDER_DEFAULT_MODEL || 'gpt-4.1';
            const transformedWorkflow = JSON.parse(JSON.stringify(tpl));
            
            // Apply model transformation
            if (transformedWorkflow.agents && Array.isArray(transformedWorkflow.agents)) {
                transformedWorkflow.agents.forEach((agent: any) => {
                    if (agent.model === '') {
                        agent.model = defaultModel;
                    }
                });
            }

            const doc = {
                name,
                description: (tpl as any).description || "",
                category: (tpl as any).category || "Other",
                authorId: "rowboat-system",
                authorName: "Rowboat",
                authorEmail: undefined,
                isAnonymous: false,
                workflow: transformedWorkflow,
                tags: ["__library__", `prebuilt:${prebuiltKey}`].filter(Boolean),
                publishedAt: now,
                lastUpdatedAt: now,
                downloadCount: 0,
                likeCount: 0,
                featured: false,
                isPublic: true,
                likes: [] as string[],
                copilotPrompt: (tpl as any).copilotPrompt || undefined,
                thumbnailUrl: undefined,
                source: 'library' as const,
            } as const;

            await collection.insertOne(doc as any);
            console.log(`[PrebuiltTemplates] Created template: ${name}`);
        }

        seededTemplates.add(prebuiltKey);
    } catch (err) {
        console.error(`[PrebuiltTemplates] Error seeding template ${prebuiltKey}:`, err);
    }
}


