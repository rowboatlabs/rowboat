'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Input } from "@heroui/react";
import { Search, Filter } from 'lucide-react';
import { AssistantCard } from './AssistantCard';
import { Button } from "@/components/ui/button";

interface TemplateItem {
    id: string;
    name: string;
    description: string;
    category: string;
    authorId?: string;
    source?: 'library' | 'community';
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
    // Template type indicator
    type: 'prebuilt' | 'community';
}

interface UnifiedTemplatesSectionProps {
    prebuiltTemplates: TemplateItem[];
    communityTemplates: TemplateItem[];
    loading?: boolean;
    error?: string | null;
    onTemplateClick?: (item: TemplateItem) => void;
    onRetry?: () => void;
    loadingItemId?: string | null;
    onLike?: (item: TemplateItem) => void;
    onShare?: (item: TemplateItem) => void;
    onDelete?: (item: TemplateItem) => void;
    getUniqueTools?: (item: TemplateItem) => Array<{ name: string; logo?: string }>;
}

export function UnifiedTemplatesSection({
    prebuiltTemplates,
    communityTemplates,
    loading = false,
    error = null,
    onTemplateClick,
    onRetry,
    loadingItemId = null,
    onLike,
    onShare,
    onDelete,
    getUniqueTools
}: UnifiedTemplatesSectionProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedType, setSelectedType] = useState<'all' | 'prebuilt' | 'community'>('all');
    const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
    const [sortBy, setSortBy] = useState<'popular' | 'newest' | 'alphabetical'>('popular');
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pendingDeleteItem, setPendingDeleteItem] = useState<TemplateItem | null>(null);

    // Row-based pagination state
    const [columns, setColumns] = useState<number>(1);
    const [rowsShown, setRowsShown] = useState<number>(4);

    useEffect(() => {
        let isMounted = true;
        (async () => {
            try {
                const resp = await fetch('/api/me', { cache: 'no-store' });
                if (!resp.ok) return;
                const data = await resp.json();
                if (isMounted) setCurrentUserId(data.id || null);
            } catch (_e) {}
        })();
        return () => { isMounted = false; };
    }, []);

    // Combine all templates
    const allTemplates = useMemo(() => {
        const combined = [
            ...prebuiltTemplates.map(t => ({ ...t, type: 'prebuilt' as const })),
            ...communityTemplates.map(t => ({ ...t, type: 'community' as const }))
        ];
        return combined;
    }, [prebuiltTemplates, communityTemplates]);

    // Get available categories
    const availableCategories = useMemo(() => {
        const categories = new Set(allTemplates.map(item => item.category));
        return Array.from(categories).sort();
    }, [allTemplates]);

    // Filter and sort templates
    const filteredTemplates = useMemo(() => {
        let filtered = [...allTemplates];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.name.toLowerCase().includes(query) ||
                item.description.toLowerCase().includes(query) ||
                item.category.toLowerCase().includes(query)
            );
        }

        // Apply type filter
        if (selectedType !== 'all') {
            filtered = filtered.filter(item => item.type === selectedType);
        }

        // Apply category filter
        if (selectedCategories.size > 0) {
            filtered = filtered.filter(item => selectedCategories.has(item.category));
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'newest':
                    if (a.createdAt && b.createdAt) {
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    }
                    return 0;
                case 'alphabetical':
                    return a.name.localeCompare(b.name);
                case 'popular':
                default:
                    // Sort across both types by like count desc; tie-break by createdAt desc, then name
                    {
                        const aLikes = a.likeCount || 0;
                        const bLikes = b.likeCount || 0;
                        if (bLikes !== aLikes) return bLikes - aLikes;
                        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                        if (bTime !== aTime) return bTime - aTime;
                        return a.name.localeCompare(b.name);
                    }
            }
        });

        return filtered;
    }, [allTemplates, searchQuery, selectedType, selectedCategories, sortBy]);

    // Determine columns based on Tailwind breakpoints used by the grid
    useEffect(() => {
        const computeColumns = () => {
            if (typeof window === 'undefined') return 1;
            // Tailwind: grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
            const isLg = window.matchMedia('(min-width: 1024px)').matches;
            const isSm = window.matchMedia('(min-width: 640px)').matches;
            return isLg ? 3 : (isSm ? 2 : 1);
        };
        const update = () => setColumns(computeColumns());
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    // Reset rowsShown when filters/sort change
    useEffect(() => {
        setRowsShown(4);
    }, [searchQuery, selectedType, selectedCategories, sortBy]);

    const itemsPerRow = Math.max(columns, 1);
    const visibleCount = rowsShown * itemsPerRow;
    const hasMore = filteredTemplates.length > visibleCount;
    const remainingItems = Math.max(filteredTemplates.length - visibleCount, 0);
    const remainingRows = Math.ceil(remainingItems / itemsPerRow);

    const visibleTemplates = filteredTemplates.slice(0, visibleCount);

    // Handle category toggle
    const toggleCategory = (category: string) => {
        setSelectedCategories(prev => {
            const newSet = new Set(prev);
            if (newSet.has(category)) {
                newSet.delete(category);
            } else {
                newSet.add(category);
            }
            return newSet;
        });
    };

    // Clear all filters
    const clearFilters = () => {
        setSearchQuery('');
        setSelectedType('all');
        setSelectedCategories(new Set());
        setSortBy('popular');
    };

    // Check if any filters are active
    const hasActiveFilters = useMemo(() => {
        return searchQuery || selectedType !== 'all' || selectedCategories.size > 0;
    }, [searchQuery, selectedType, selectedCategories]);

    if (loading) {
        return (
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                <div className="text-left mb-6">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                        Templates
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Discover and use pre-built and community templates.
                    </p>
                </div>
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="text-gray-500 dark:text-gray-400 mt-2">Loading templates...</p>
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
                        Templates
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Discover and use pre-built and community templates.
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
                    Templates
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    Discover and use pre-built and community templates.
                </p>
            </div>

            {/* Filters */}
            <div className="space-y-4 mb-6">
                {/* Search and Type Filters */}
                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <Input
                            placeholder="Search templates..."
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
                        {/* Type Filter Segmented Control */}
                        <div className="flex gap-0.5 items-center h-8 rounded-full border border-gray-200 dark:border-gray-700 p-0 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
                            {[
                                { key: 'all', label: 'All', count: allTemplates.length },
                                { key: 'prebuilt', label: 'Library', count: prebuiltTemplates.length },
                                { key: 'community', label: 'Community', count: communityTemplates.length }
                            ].map(({ key, label, count }) => (
                                <button
                                    key={key}
                                    onClick={() => setSelectedType(key as any)}
                                    aria-pressed={selectedType === key}
                                    className={`inline-flex items-center h-8 px-2.5 rounded-full text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                        selectedType === key
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : 'bg-transparent text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
                                    }`}
                                >
                                    {label} ({count})
                                </button>
                            ))}
                        </div>

                        {/* Sort Dropdown */}
                        <div className="relative">
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as any)}
                                className="w-44 h-8 px-4 pr-10 border border-gray-300 dark:border-gray-700 rounded-full bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 appearance-none text-sm hover:bg-gray-50 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                            >
                                <option value="popular">Most Popular</option>
                                <option value="newest">Newest First</option>
                                <option value="alphabetical">A-Z</option>
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                                <svg className="w-4 h-4 text-gray-400 -translate-y-[2px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Category Filters */}
                <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Filter size={14} />
                        <span>Categories:</span>
                    </div>
                    {availableCategories.map((category) => (
                        <button
                            key={category}
                            onClick={() => toggleCategory(category)}
                            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${
                                selectedCategories.has(category)
                                    ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700'
                                    : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700'
                            }`}
                        >
                            {category}
                        </button>
                    ))}
                </div>

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <button
                            onClick={clearFilters}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                        >
                            Clear all filters
                        </button>
                    </div>
                )}
            </div>

            {/* Results */}
            <div className="space-y-4">
                {filteredTemplates.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 dark:text-gray-400">
                            {searchQuery || selectedType !== 'all' || selectedCategories.size > 0
                                ? 'No templates found matching your filters'
                                : 'No templates available'
                            }
                        </p>
                        {(searchQuery || selectedType !== 'all' || selectedCategories.size > 0) && (
                            <button
                                onClick={clearFilters}
                                className="mt-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                            Showing {Math.min(visibleCount, filteredTemplates.length)} of {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''} ({rowsShown} row{rowsShown !== 1 ? 's' : ''})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {visibleTemplates.map((item) => (
                                <AssistantCard
                                    key={`${item.type}-${item.id}`}
                                    id={item.id}
                                    name={item.name}
                                    description={item.description}
                                    category={item.category}
                                    tools={item.tools}
                                    authorName={item.authorName}
                                    isAnonymous={item.isAnonymous}
                                    likeCount={item.likeCount}
                                    createdAt={item.createdAt}
                                    onClick={() => onTemplateClick?.(item)}
                                    loading={loadingItemId === item.id}
                                    getUniqueTools={getUniqueTools}
                                    onLike={() => onLike?.(item)}
                                    onShare={() => onShare?.(item)}
                                    onDelete={onDelete && currentUserId && item.type === 'community' && item.authorId === currentUserId ? () => {
                                        setPendingDeleteItem(item);
                                        setConfirmOpen(true);
                                    } : undefined}
                                    isLiked={item.isLiked}
                                    templateType={item.type}
                                />
                            ))}
                        </div>
                        {hasMore && (
                            <div className="flex items-center justify-center pt-2">
                                <button
                                    onClick={() => setRowsShown(prev => prev + 4)}
                                    className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium underline-offset-2 hover:underline"
                                >
                                    View more
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        
        {/* Delete confirmation modal */}
        {confirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-w-sm w-full p-5">
                    <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete template?</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                        This will permanently remove &quot;{pendingDeleteItem?.name}&quot; from the community templates. This action cannot be undone.
                    </div>
                    <div className="mt-5 flex justify-end gap-2">
                        <button
                            onClick={() => { setConfirmOpen(false); setPendingDeleteItem(null); }}
                            className="px-4 py-2 text-sm rounded-md bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={async () => {
                                if (pendingDeleteItem && onDelete) {
                                    await onDelete(pendingDeleteItem);
                                }
                                setConfirmOpen(false);
                                setPendingDeleteItem(null);
                            }}
                            className="px-4 py-2 text-sm rounded-md bg-red-600 hover:bg-red-700 text-white"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            </div>
        )}
        </div>
    );
}
