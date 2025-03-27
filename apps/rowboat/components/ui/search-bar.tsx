'use client';
import { Input } from "@/components/ui/input";
import { SearchIcon, XIcon } from "lucide-react";
import { InputHTMLAttributes } from "react";
import { cn } from "@heroui/react";

interface SearchBarProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    value: string;
    onChange: (value: string) => void;
    onClear?: () => void;
}

export function SearchBar({ 
    value, 
    onChange,
    onClear,
    className,
    ...props 
}: SearchBarProps) {
    return (
        <div className="relative">
            <SearchIcon 
                size={16} 
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <Input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={cn("pl-9 pr-8 bg-transparent", className)}
                {...props}
            />
            {value && (
                <button
                    type="button"
                    onClick={onClear}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                    <XIcon size={14} />
                </button>
            )}
        </div>
    );
}
