'use client';
import { cn } from "@heroui/react";
import { SearchIcon } from "lucide-react";
import { tokens } from "@/app/styles/design-tokens";

export type TimeFilter = 'all' | 'today' | 'week' | 'month';

interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    onTimeFilterChange: (filter: TimeFilter) => void;
    timeFilter: TimeFilter;
    placeholder?: string;
}

export function SearchInput({ 
    value, 
    onChange, 
    onTimeFilterChange,
    timeFilter,
    placeholder = "Search projects..." 
}: SearchInputProps) {
    return (
        <div className="space-y-3">
            <div className="relative">
                <SearchIcon 
                    size={16} 
                    className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2",
                        tokens.colors.light.text.tertiary,
                        tokens.colors.dark.text.tertiary
                    )}
                />
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={cn(
                        "w-full pl-9 pr-4 py-2",
                        tokens.typography.sizes.sm,
                        tokens.radius.md,
                        tokens.transitions.default,
                        "bg-gray-50 dark:bg-gray-800",
                        tokens.colors.light.text.primary,
                        tokens.colors.dark.text.primary,
                        "placeholder:text-gray-400 dark:placeholder:text-gray-500",
                        "border border-gray-200 dark:border-gray-700",
                        "focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50",
                        "focus:border-transparent"
                    )}
                />
            </div>
            <div className="flex gap-2">
                {(['all', 'today', 'week', 'month'] as const).map(filter => (
                    <button
                        key={filter}
                        onClick={() => onTimeFilterChange(filter)}
                        className={cn(
                            "px-3 py-1",
                            tokens.typography.sizes.sm,
                            tokens.typography.weights.medium,
                            tokens.radius.md,
                            tokens.transitions.default,
                            timeFilter === filter
                                ? "bg-indigo-600 text-white"
                                : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
                            "hover:bg-gray-100 dark:hover:bg-gray-700",
                            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50"
                        )}
                    >
                        {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                ))}
            </div>
        </div>
    );
} 