import { Project } from "@/app/lib/types/project_types";
import { z } from "zod";
import { ProjectList } from "./project-list";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";
import clsx from 'clsx';
import { XMarkIcon } from "@heroicons/react/24/outline";

interface SearchProjectsProps {
    projects: z.infer<typeof Project>[];
    isLoading: boolean;
    heading: string;
    subheading?: string;
    className?: string;
    onClose?: () => void;
}

export function SearchProjects({ 
    projects, 
    isLoading,
    heading,
    subheading,
    className,
    onClose
}: SearchProjectsProps) {
    return (
        <div className={clsx("card", className)}>
            <div className="px-4 pt-4 pb-6 flex-none">
                <div className="flex justify-between items-center">
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                        {heading}
                    </h1>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-gray-500 hover:text-gray-700"
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    )}
                </div>
                {subheading && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {subheading}
                    </p>
                )}
            </div>
            <HorizontalDivider />
            <div className="flex-1 overflow-hidden">
                <ProjectList 
                    projects={projects}
                    isLoading={isLoading}
                    searchQuery=""
                />
            </div>
        </div>
    );
}
