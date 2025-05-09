import { Metadata } from "next";
import { Form } from "./form";
import { redirect } from "next/navigation";
import { USE_RAG, USE_RAG_UPLOADS, USE_RAG_S3_UPLOADS, USE_RAG_SCRAPING } from "../../../../lib/feature_flags";

export const metadata: Metadata = {
    title: "Add data source"
}

export default async function Page({
    params
}: {
    params: { projectId: string }
}) {
    if (!USE_RAG) {
        redirect(`/projects/${params.projectId}`);
    }

    return (
        <Form
            projectId={params.projectId}
            useRagUploads={USE_RAG_UPLOADS}
            useRagS3Uploads={USE_RAG_S3_UPLOADS}
            useRagScraping={USE_RAG_SCRAPING}
        />
    );
}