export function PageSection({
    title,
    children,
    danger = false,
}: {
    title: string;
    children: React.ReactNode;
    danger?: boolean;
}) {
    return <div className="pb-2">
        <div className={`text-lg pb-2 border-b border-b-gray-100` + (danger ? ' text-red-600 border-b-red-600' : '')}>
            {title}
        </div>
        <div className="px-4 py-4">
            {children}
        </div>
    </div>
}