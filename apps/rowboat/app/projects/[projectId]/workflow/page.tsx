import { Metadata } from "next";
import { App } from "./app";
import { USE_RAG, USE_RAG_UPLOADS, USE_RAG_S3_UPLOADS, USE_RAG_SCRAPING } from "@/app/lib/feature_flags";
import { notFound } from "next/navigation";
import { requireActiveBillingSubscription } from '@/app/lib/billing';
import { container } from "@/di/container";
import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";

const projectsRepository = container.resolve<IProjectsRepository>('projectsRepository');

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
    const project = await projectsRepository.fetch(params.projectId);
    if (!project) {
        notFound();
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
            chatWidgetHost={process.env.CHAT_WIDGET_HOST || ''}
        />
    );
}
