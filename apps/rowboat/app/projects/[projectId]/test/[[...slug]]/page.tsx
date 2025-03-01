import { App } from "./app";

export default function Page({ params }: { params: { projectId: string, slug?: string[] } }) {
  return <App
    projectId={params.projectId}
    slug={params.slug}
  />;
}