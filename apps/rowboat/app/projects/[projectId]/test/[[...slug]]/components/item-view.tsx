// First, let's create a reusable component for item views
export function ItemView({
    items,
    actions
}: {
    items: { label: string; value: string | React.ReactNode }[];
    actions: React.ReactNode;
}) {
    return (
        <div className="max-w-3xl">
            {/* Content */}
            <div className="bg-white dark:bg-neutral-950 rounded-lg border border-gray-200 dark:border-neutral-800 overflow-hidden">
                <div className="divide-y divide-gray-100 dark:divide-neutral-800">
                    {items.map((item, index) => (
                        <div 
                            key={index} 
                            className="px-6 py-4 flex flex-col gap-1"
                        >
                            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-neutral-400">
                                {item.label}
                            </dt>
                            <dd className="text-sm text-gray-900 dark:text-white">
                                {item.value || "—"}
                            </dd>
                        </div>
                    ))}
                </div>

                {/* Actions */}
                <div className="px-6 py-4 bg-gray-50 dark:bg-neutral-900 border-t border-gray-200 dark:border-neutral-800">
                    <div className="flex gap-2">
                        {actions}
                    </div>
                </div>
            </div>
        </div>
    );
} 