import { Metadata } from "next";
import { App } from "./app";
import { USE_RAG, USE_RAG_UPLOADS, USE_RAG_S3_UPLOADS, USE_RAG_SCRAPING } from "@/app/lib/feature_flags";
import { projectsCollection } from "@/app/lib/mongodb";
import { notFound } from "next/navigation";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { migrate_versioned_workflows } from "@/app/lib/migrate_versioned_workflows";

const DEFAULT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || "gpt-4.1";

export const metadata: Metadata = {
    title: "Workflow"
}

export default async function Page(
    props: {
        params: Promise<{ projectId: string }>;
    }
) {
    const params = await props.params;
    await requireActiveBillingSubscription();
    console.log('->>> workflow page being rendered');
    const project = await projectsCollection.findOne({
        _id: params.projectId,
    });
    if (!project) {
        notFound();
    }

    // migrate versioned workflows for this project
    if (!project.draftWorkflow) {
        await migrate_versioned_workflows(params.projectId);
    }

    console.log('/workflow page.tsx serve');

    return (
        <App
            projectId={params.projectId}
            useRag={USE_RAG}
            useRagUploads={USE_RAG_UPLOADS}
            useRagS3Uploads={USE_RAG_S3_UPLOADS}
            useRagScraping={USE_RAG_SCRAPING}
            defaultModel={DEFAULT_MODEL}
        />
    );
}
