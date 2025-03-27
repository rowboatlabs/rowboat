import { cn } from "@heroui/react";

interface HorizontalDividerProps {
    className?: string;
}

export function HorizontalDivider({ className }: HorizontalDividerProps) {
    return (
        <div className={cn(
            "border-t border-gray-200 dark:border-gray-700",
            className
        )} />
    );
}
