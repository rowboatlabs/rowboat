import { Metadata } from "next";
import { App } from "./app";
import { USE_RAG } from "@/app/lib/feature_flags";
import { projectsCollection } from "@/app/lib/mongodb";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
    title: "Workflow"
}

export default async function Page({
    params,
}: {
    params: { projectId: string };
}) {
    const project = await projectsCollection.findOne({
        _id: params.projectId,
    });
    if (!project) {
        notFound();
    }
    const toolWebhookUrl = project.webhookUrl ?? '';

    return <App
        projectId={params.projectId}
        useRag={USE_RAG}
        mcpServerUrls={project.mcpServers ?? []}
        toolWebhookUrl={toolWebhookUrl}
    />;
}
