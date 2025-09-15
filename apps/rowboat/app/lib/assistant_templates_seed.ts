import { db } from "@/app/lib/mongodb";
import { prebuiltTemplates } from "@/app/lib/prebuilt-cards";

// idempotent seed: creates library (prebuilt) templates in DB if missing
// Uses name+authorName match to avoid duplicates; tags include a stable prebuilt key
export async function ensureLibraryTemplatesSeeded(): Promise<void> {
    try {
        const collection = db.collection("assistant_templates");
        const now = new Date().toISOString();

        const entries = Object.entries(prebuiltTemplates);
        for (const [prebuiltKey, tpl] of entries) {
            // minimal guard; only ingest valid workflow-like objects
            if (!(tpl as any)?.agents || !Array.isArray((tpl as any).agents)) continue;

            const name = (tpl as any).name || prebuiltKey;

            // check if already present (by name + authorName Rowboat and special tag)
            const existing = await collection.findOne({ name, authorName: "Rowboat", tags: { $in: [ `prebuilt:${prebuiltKey}`, "__library__" ] } });
            if (existing) continue;

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


