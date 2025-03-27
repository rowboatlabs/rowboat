'use client';
import { Project } from "@/app/lib/types/project_types";
import { Spinner } from "@heroui/react";
import { z } from "zod";
import { ProjectCard } from "./project-card";
import { cn } from "@heroui/react";

interface ProjectListProps {
    projects: z.infer<typeof Project>[];
    isLoading: boolean;
}

export function ProjectList({ projects, isLoading }: ProjectListProps) {
    if (isLoading) {
        return (
            <div className="mt-8 flex justify-center">
                <Spinner size="sm" />
            </div>
        );
    }
    
    if (projects.length === 0) {
        return (
            <div className="mt-8 text-center">
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                    You do not have any projects.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {projects.map((project) => (
                <ProjectCard key={project._id} project={project} />
            ))}
        </div>
    );
} 