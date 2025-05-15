import { ReactNode } from "react";

interface SectionProps {
    title: string;
    description?: string;
    children: ReactNode;
    className?: string;
}

export function Section({ title, description, children, className }: SectionProps) {
    return (
        <div className={`rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden ${className || ''}`}>
            <div className="px-6 pt-5 pb-4">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {title}
                </h2>
                {description && (
                    <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                        {description}
                    </p>
                )}
            </div>
            <div className="px-6 pb-6">
                {children}
            </div>
        </div>
    );
}

export function SectionRow({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={`flex items-start gap-6 py-1 ${className || ''}`}>
            {children}
        </div>
    );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={`w-24 flex-shrink-0 text-sm text-gray-500 dark:text-gray-400 ${className || ''}`}>
            {children}
        </div>
    );
}

export function SectionContent({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <div className={`flex-1 ${className || ''}`}>
            {children}
        </div>
    );
}
