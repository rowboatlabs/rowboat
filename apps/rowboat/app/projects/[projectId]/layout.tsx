import { Nav } from "./nav";

export default async function Layout({
    params,
    children
}: {
    params: { projectId: string }
    children: React.ReactNode
}) {
    const useDataSources = process.env.USE_DATA_SOURCES === 'true';

    return <div className="flex h-full">
        <Nav projectId={params.projectId} useDataSources={useDataSources} />
        <div className="grow p-2 overflow-auto bg-background dark:bg-background rounded-tl-lg">
            {children}
        </div>
    </div>;
}