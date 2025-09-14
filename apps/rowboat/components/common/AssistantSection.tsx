'use client';

import React, { useState, useEffect } from 'react';
import { Input } from "@heroui/react";
import { Search } from 'lucide-react';
import { AssistantCard } from './AssistantCard';

interface AssistantItem {
    id: string;
    name: string;
    description: string;
    category: string;
    tools?: Array<{
        name: string;
        logo?: string;
    }>;
    // Community-specific
    authorName?: string;
    isAnonymous?: boolean;
    likeCount?: number;
    createdAt?: string;
    isLiked?: boolean;
    // Pre-built specific
    estimatedComplexity?: string;
}

interface AssistantSectionProps {
    title: string;
    description: string;
    items: AssistantItem[];
    loading?: boolean;
    error?: string | null;
    onItemClick?: (item: AssistantItem) => void;
    onRetry?: () => void;
    loadingItemId?: string | null;
    emptyMessage?: string;
    // Community-specific callbacks
    onLike?: (item: AssistantItem) => void;
    onShare?: (item: AssistantItem) => void;
    // Pre-built specific
    getUniqueTools?: (item: AssistantItem) => Array<{ name: string; logo?: string }>;
    // Filter state
    initialSearchQuery?: string;
    initialSelectedCategory?: string;
    onFiltersChange?: (filters: {
        searchQuery: string;
        selectedCategory: string;
    }) => void;
}


export function AssistantSection({
    title,
    description,
    items,
    loading = false,
    error = null,
    onItemClick,
    onRetry,
    loadingItemId = null,
    emptyMessage = "No assistants available",
    onLike,
    onShare,
    getUniqueTools,
    initialSearchQuery = '',
    initialSelectedCategory = '',
    onFiltersChange
}: AssistantSectionProps) {
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
    const [selectedCategory, setSelectedCategory] = useState(initialSelectedCategory);

    // Notify parent of filter changes if callback provided
    useEffect(() => {
        if (onFiltersChange) {
            onFiltersChange({
                searchQuery,
                selectedCategory
            });
        }
    }, [searchQuery, selectedCategory, onFiltersChange]);

    // Get available categories from items
    const availableCategories = React.useMemo(() => {
        const categories = new Set(items.map(item => item.category));
        return Array.from(categories).sort();
    }, [items]);

    // Filter items
    const filteredItems = React.useMemo(() => {
        let filtered = [...items];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.name.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query) ||
                item.category.toLowerCase().includes(query)
            );
        }

        // Apply category filter
        if (selectedCategory) {
            filtered = filtered.filter(item => item.category === selectedCategory);
        }

        return filtered;
    }, [items, searchQuery, selectedCategory]);

    const isCommunity = items.length > 0 && items[0].authorName !== undefined;

    if (loading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                <div className="text-left mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                        {title}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {description}
                    </p>
                </div>
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="text-gray-500 dark:text-gray-400 mt-2">Loading assistants...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                <div className="text-left mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                        {title}
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        {description}
                    </p>
                </div>
                <div className="text-center py-12">
                    <p className="text-red-500 dark:text-red-400">{error}</p>
                    {onRetry && (
                        <button
                            onClick={onRetry}
                            className="mt-4 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                            Try Again
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="text-left mb-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    {title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    {description}
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1">
                    <Input
                        placeholder="Search assistants..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        startContent={<Search size={16} className="text-gray-400" />}
                        className="max-w-md"
                        classNames={{
                            input: "focus:outline-none focus:ring-0 focus:border-gray-300 dark:focus:border-gray-600",
                            inputWrapper: "focus-within:ring-0 focus-within:ring-offset-0 focus-within:border-gray-300 dark:focus-within:border-gray-600"
                        }}
                    />
                </div>
                
                <div className="flex gap-2">
                    <div className="relative">
                        <select
                            value={selectedCategory}
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="w-48 px-3 py-2 pr-10 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 appearance-none text-sm"
                        >
                            <option value="">All Categories</option>
                            {availableCategories.map((category) => (
                                <option key={category} value={category}>
                                    {category}
                                </option>
                            ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid */}
            {filteredItems.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-gray-500 dark:text-gray-400">{emptyMessage}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredItems.map((item) => (
                        <AssistantCard
                            key={item.id}
                            id={item.id}
                            name={item.name}
                            description={item.description}
                            category={item.category}
                            tools={item.tools}
                            authorName={item.authorName}
                            isAnonymous={item.isAnonymous}
                            likeCount={item.likeCount}
                            createdAt={item.createdAt}
                            estimatedComplexity={item.estimatedComplexity}
                            onClick={() => onItemClick?.(item)}
                            loading={loadingItemId === item.id}
                            getUniqueTools={getUniqueTools}
                            onLike={onLike ? () => onLike(item) : undefined}
                            onShare={onShare ? () => onShare(item) : undefined}
                            isLiked={item.isLiked}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}