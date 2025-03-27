'use client';
import { Project } from "@/app/lib/types/project_types";
import { default as NextLink } from "next/link";
import { RelativeTime } from "@primer/react";
import { z } from "zod";
import { cn } from "@heroui/react";

interface ProjectCardProps {
    project: z.infer<typeof Project>;
}

export function ProjectCard({ project }: ProjectCardProps) {
    return (
        <NextLink
            href={`/projects/${project._id}`}
            className={cn(
                "card",
                "flex flex-col",
                "hover:shadow-md transition-shadow duration-200",
                "w-full" // Ensure full width
            )}
        >
            <div>
                <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                    {project.name}
                </h2>
            </div>
            <div className="flex items-center gap-2 mt-2">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                    Created <RelativeTime date={new Date(project.createdAt)} />
                </div>
            </div>
        </NextLink>
    );
} 