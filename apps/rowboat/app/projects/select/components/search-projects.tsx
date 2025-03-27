import { Project } from "@/types/project_types";
import { z } from "zod";
import { useMemo } from "react";
import Fuse from 'fuse.js';
import { SearchInput, TimeFilter } from "./search-input";
import { isToday, isThisWeek, isThisMonth } from "@/lib/utils/date";
import { ProjectList } from "./project-list";
import { SectionHeading } from "@/components/ui/section-heading";
import { HorizontalDivider } from "@/components/ui/horizontal-divider";

interface SearchOptions {
    query: string;
    timeFilter: TimeFilter;
}

interface SearchProjectsProps {
    projects: z.infer<typeof Project>[];
    isLoading: boolean;
    searchOptions: SearchOptions;
    onSearchOptionsChange: (options: SearchOptions) => void;
    heading: string;
    subheading: string;
}

export function SearchProjects({ 
    projects, 
    isLoading, 
    searchOptions, 
    onSearchOptionsChange,
    heading,
    subheading
}: SearchProjectsProps) {
    const fuse = useMemo(() => {
        const fuseOptions = {
            keys: ['name'],
            threshold: 0.3,
        };
        return new Fuse(projects, fuseOptions);
    }, [projects]);

    const filteredProjects = useMemo(() => {
        if (!searchOptions.query.trim() && searchOptions.timeFilter === 'all') {
            return projects;
        }

        let results = projects;

        if (searchOptions.query.trim()) {
            const fuseResults = fuse.search(searchOptions.query);
            results = fuseResults
                .filter(result => result.score && result.score < 0.6)
                .map(result => result.item);
        }

        if (searchOptions.timeFilter !== 'all') {
            results = results.filter(project => {
                const projectDate = new Date(project.createdAt);
                switch (searchOptions.timeFilter) {
                    case 'today':
                        return isToday(projectDate);
                    case 'week':
                        return isThisWeek(projectDate);
                    case 'month':
                        return isThisMonth(projectDate);
                    default:
                        return true;
                }
            });
        }

        return results;
    }, [projects, searchOptions, fuse]);

    return (
        <section className="card overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 200px)' }}>
            <div className="px-4 pt-4 flex-none">
                <SectionHeading
                    subheading={subheading}
                >
                    {heading}
                </SectionHeading>
                <div className="py-4">
                    <SearchInput
                        value={searchOptions.query}
                        onChange={(query) => onSearchOptionsChange({ ...searchOptions, query })}
                        timeFilter={searchOptions.timeFilter}
                        onTimeFilterChange={(timeFilter) => onSearchOptionsChange({ ...searchOptions, timeFilter })}
                    />
                </div>
            </div>
            <HorizontalDivider />
            <div className="flex-1 overflow-hidden">
                <ProjectList 
                    projects={filteredProjects}
                    isLoading={isLoading}
                    searchQuery={searchOptions.query}
                />
            </div>
        </section>
    );
}
