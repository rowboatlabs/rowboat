'use client';
import { Project } from "@/app/lib/types/project_types";
import { Spinner } from "@heroui/react";
import { z } from "zod";
import { ProjectCard } from "./project-card";

interface ProjectListProps {
    projects: z.infer<typeof Project>[];
    isLoading: boolean;
    searchQuery: string;
}

export function ProjectList({ projects, isLoading, searchQuery }: ProjectListProps) {
    if (isLoading) {
        return (
            <div className="flex justify-center py-8">
                <Spinner size="sm" />
            </div>
        );
    }
    
    if (projects.length === 0) {
        if (searchQuery) {
            return (
                <div className="py-8 text-center">
                    <p className="text-gray-600 dark:text-gray-400 text-sm">
                        No projects found matching "{searchQuery}"
                    </p>
                </div>
            );
        }
        
        return (
            <div className="py-8 text-center">
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                    You do not have any projects.
                </p>
            </div>
        );
    }

    // Sort projects by createdAt in descending order
    const sortedProjects = [...projects].sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return (
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {sortedProjects.map((project) => (
                <ProjectCard key={project._id} project={project} />
            ))}
        </div>
    );
} 