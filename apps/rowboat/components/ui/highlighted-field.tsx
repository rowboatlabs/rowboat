import { cn } from "@heroui/react";

interface HighlightedFieldProps {
    children: React.ReactNode;
    className?: string;
}

export function HighlightedField({ children, className }: HighlightedFieldProps) {
    return (
        <div 
            className={cn(
                "min-h-[60px] w-full p-2 rounded-md text-sm text-gray-500 dark:text-gray-400 text-left",
                "bg-gray-50 dark:bg-gray-800",
                className
            )}
        >
            {children}
        </div>
    );
}
