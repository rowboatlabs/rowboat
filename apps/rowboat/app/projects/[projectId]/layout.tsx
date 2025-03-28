export default async function Layout({
    params,
    children
}: {
    params: { projectId: string }
    children: React.ReactNode
}) {
    return children;
}