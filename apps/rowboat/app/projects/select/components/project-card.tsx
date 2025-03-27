'use client';
import { Project } from "@/app/lib/types/project_types";
import { default as NextLink } from "next/link";
import { RelativeTime } from "@primer/react";
import { z } from "zod";
import { cn } from "@heroui/react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

interface ProjectCardProps {
    project: z.infer<typeof Project>;
}

export function ProjectCard({ project }: ProjectCardProps) {
    return (
        <NextLink
            href={`/projects/${project._id}`}
            className={cn(
                "block w-full px-4 py-3", // Consistent padding
                "hover:bg-gray-50 dark:hover:bg-gray-800/50", // Subtle hover state
                "transition-colors duration-200",
                "group" // For hover effects on children
            )}
        >
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-base font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {project.name}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        Created <RelativeTime date={new Date(project.createdAt)} />
                    </p>
                </div>
                <div className="text-gray-400 dark:text-gray-600 group-hover:text-gray-600 dark:group-hover:text-gray-400">
                    <ChevronRightIcon size={20} />
                </div>
            </div>
        </NextLink>
    );
} 