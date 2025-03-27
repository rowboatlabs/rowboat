'use client';
import { Project } from "@/app/lib/types/project_types";
import { default as NextLink } from "next/link";
import { z } from "zod";
import { cn } from "@heroui/react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { formatDistanceToNow } from "date-fns";
import { tokens } from "@/app/styles/design-tokens";

interface ProjectCardProps {
    project: z.infer<typeof Project>;
}

export function ProjectCard({ project }: ProjectCardProps) {
    return (
        <NextLink
            href={`/projects/${project._id}`}
            className={cn(
                "block px-4 py-3",
                tokens.transitions.default,
                tokens.colors.light.surfaceHover,
                tokens.colors.dark.surfaceHover,
                "group"
            )}
        >
            <div className="flex justify-between items-start">
                <div className="space-y-1">
                    <h3 className={cn(
                        tokens.typography.sizes.base,
                        tokens.typography.weights.medium,
                        tokens.colors.light.text.primary,
                        tokens.colors.dark.text.primary,
                        "group-hover:text-indigo-600 dark:group-hover:text-indigo-400",
                        tokens.transitions.default
                    )}>
                        {project.name}
                    </h3>
                    <p className={cn(
                        tokens.typography.sizes.xs,
                        tokens.colors.light.text.muted,
                        tokens.colors.dark.text.muted
                    )}>
                        Created {formatDistanceToNow(new Date(project.createdAt))} ago
                    </p>
                </div>
                <ChevronRightIcon 
                    className={cn(
                        "w-5 h-5",
                        tokens.colors.light.text.muted,
                        tokens.colors.dark.text.muted,
                        "transform transition-transform group-hover:translate-x-0.5"
                    )}
                />
            </div>
        </NextLink>
    );
} 