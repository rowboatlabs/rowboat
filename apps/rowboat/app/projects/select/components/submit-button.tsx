'use client';
import { useFormStatus } from "react-dom";
import { cn } from "@heroui/react";
import { tokens } from "@/app/styles/design-tokens";
import { PlusIcon } from "lucide-react";

export function Submit() {
    const { pending } = useFormStatus();

    return (
        <div className="flex flex-col items-start gap-2">
            {pending && (
                <div className={cn(
                    "text-sm",
                    tokens.colors.light.text.secondary,
                    tokens.colors.dark.text.secondary
                )}>
                    Please hold on while we set up your project&hellip;
                </div>
            )}
            <button
                type="submit"
                form="create-project-form"
                disabled={pending}
                className={cn(
                    "flex items-center gap-2",
                    "px-4 py-2.5",
                    "outline-none",
                    tokens.typography.sizes.sm,
                    tokens.typography.weights.medium,
                    tokens.radius.full,
                    tokens.transitions.default,
                    tokens.shadows.sm,
                    "text-white",
                    "bg-indigo-600 hover:bg-indigo-500",
                    "dark:bg-indigo-500 dark:hover:bg-indigo-400",
                    "hover:shadow-md",
                    "transform hover:scale-[1.02]",
                    pending && "opacity-50 cursor-not-allowed"
                )}
            >
                <PlusIcon size={16} />
                Create project
            </button>
        </div>
    );
} 