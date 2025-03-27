'use client';
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/search-bar";

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
        <div className="space-y-2">
            <SearchBar
                value={value}
                onChange={onChange}
                onClear={() => onChange('')}
                placeholder={placeholder}
            />
            <div className="flex gap-2 text-sm">
                {(['all', 'today', 'week', 'month'] as const).map(filter => (
                    <Button
                        key={filter}
                        size="sm"
                        variant={timeFilter === filter ? 'default' : 'ghost'}
                        onClick={() => onTimeFilterChange(filter)}
                    >
                        {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </Button>
                ))}
            </div>
        </div>
    );
} 