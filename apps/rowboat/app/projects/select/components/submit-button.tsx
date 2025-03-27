'use client';
import { useFormStatus } from "react-dom";
import { cn } from "@heroui/react";
import { tokens } from "@/app/styles/design-tokens";

export function Submit() {
    const { pending } = useFormStatus();

    return <>
        {pending && <div className="text-gray-400">Please hold on while we set up your project&hellip;</div>}
        <button
            type="submit"
            className={cn(
                "px-4 py-2.5",
                tokens.typography.sizes.sm,
                tokens.typography.weights.medium,
                tokens.radius.full,
                tokens.transitions.default,
                tokens.shadows.sm,
                tokens.focus.default,
                tokens.focus.dark,
                "text-white",
                "bg-indigo-600 hover:bg-indigo-500",
                "dark:bg-indigo-500 dark:hover:bg-indigo-400",
                "hover:shadow-md",
                "transform hover:scale-[1.02]"
            )}
        >
            Create project
        </button>
    </>;
} 