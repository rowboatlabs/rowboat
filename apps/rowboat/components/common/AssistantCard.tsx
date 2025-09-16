'use client';

import React from 'react';
import { clsx } from 'clsx';
import { PictureImg } from '@/components/ui/picture-img';
import { Heart, Share2, Calendar } from 'lucide-react';

// Helper function to get relative time
const getRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) {
        return 'just now';
    }
    
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return `${diffInMinutes} minute${diffInMinutes === 1 ? '' : 's'} ago`;
    }
    
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return `${diffInHours} hour${diffInHours === 1 ? '' : 's'} ago`;
    }
    
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) {
        return `${diffInDays} day${diffInDays === 1 ? '' : 's'} ago`;
    }
    
    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) {
        return `${diffInWeeks} week${diffInWeeks === 1 ? '' : 's'} ago`;
    }
    
    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
        return `${diffInMonths} month${diffInMonths === 1 ? '' : 's'} ago`;
    }
    
    const diffInYears = Math.floor(diffInDays / 365);
    return `${diffInYears} year${diffInYears === 1 ? '' : 's'} ago`;
};

interface AssistantCardProps {
    id: string;
    name: string;
    description: string;
    category: string;
    tools?: Array<{
        name: string;
        logo?: string;
    }>;
    // Community-specific props
    authorName?: string;
    isAnonymous?: boolean;
    likeCount?: number;
    createdAt?: string;
    onLike?: () => void;
    onShare?: () => void;
    onDelete?: () => void;
    isLiked?: boolean;
    // Template type indicator
    templateType?: 'prebuilt' | 'community';
    // Common props
    onClick?: () => void;
    loading?: boolean;
    disabled?: boolean;
    getUniqueTools?: (item: any) => Array<{ name: string; logo?: string }>;
    // UI flags
    hideLikes?: boolean;
}

export function AssistantCard({
    id,
    name,
    description,
    category,
    tools = [],
    authorName,
    isAnonymous = false,
    likeCount = 0,
    createdAt,
    onLike,
    onShare,
    isLiked = false,
    onDelete,
    templateType,
    onClick,
    loading = false,
    disabled = false,
    getUniqueTools,
    hideLikes = false
}: AssistantCardProps) {
    const displayTools = getUniqueTools ? getUniqueTools({ tools }) : tools;
    const [isDescriptionExpanded, setIsDescriptionExpanded] = React.useState(false);
    const [showDescriptionToggle, setShowDescriptionToggle] = React.useState(false);
    const descriptionRef = React.useRef<HTMLDivElement | null>(null);
    const [copied, setCopied] = React.useState(false);
    React.useEffect(() => {
        let t: any;
        if (copied) {
            t = setTimeout(() => setCopied(false), 1500);
        }
        return () => t && clearTimeout(t);
    }, [copied]);

    React.useEffect(() => {
        const el = descriptionRef.current;
        if (!el) return;
        // Measure if truncated (only when collapsed)
        if (!isDescriptionExpanded) {
            setShowDescriptionToggle(el.scrollHeight > el.clientHeight + 1);
        } else {
            setShowDescriptionToggle(true);
        }
    }, [description, isDescriptionExpanded]);

    const getCategoryColor = (category: string) => {
        const lowerCategory = category.toLowerCase();
        if (lowerCategory.includes('work productivity')) {
            return 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300';
        } else if (lowerCategory.includes('developer productivity')) {
            return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300';
        } else if (lowerCategory.includes('news') || lowerCategory.includes('social')) {
            return 'bg-green-50 text-green-700 dark:bg-green-400/10 dark:text-green-300';
        } else if (lowerCategory.includes('customer support')) {
            return 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300';
        } else if (lowerCategory.includes('education')) {
            return 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300';
        } else if (lowerCategory.includes('entertainment')) {
            return 'bg-purple-50 text-purple-700 dark:bg-purple-400/10 dark:text-purple-300';
        } else {
            return 'bg-gray-50 text-gray-700 dark:bg-gray-400/10 dark:text-gray-300';
        }
    };

    return (
        <div
            onClick={onClick}
            className={clsx(
                "relative block p-4 border border-gray-200 dark:border-gray-700 rounded-xl transition-all group text-left cursor-pointer",
                "hover:border-blue-300 dark:hover:border-blue-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 hover:shadow-md",
                loading && "opacity-90 cursor-not-allowed",
                disabled && "opacity-50 cursor-not-allowed"
            )}
        >
            <div className="space-y-3">
                {/* Title and Description */}
                <div>
                    <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1 flex-1">
                            {name}
                        </div>
                        {/* Template Type Badge */}
                        {templateType && (
                            <span className={clsx(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0",
                                templateType === 'prebuilt' 
                                    ? "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-300"
                                    : "bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300"
                            )}>
                                {templateType === 'prebuilt' ? 'Library' : 'Community'}
                            </span>
                        )}
                    </div>
                    <div className="mt-1 relative">
                        <div
                            ref={descriptionRef}
                            className={clsx(
                                "text-sm leading-5 text-gray-600 dark:text-gray-400 relative min-h-[2.5rem]",
                                (!isDescriptionExpanded && showDescriptionToggle) && "pr-20",
                                !isDescriptionExpanded && "line-clamp-2"
                            )}
                        >
                            {description}
                        </div>
                        {showDescriptionToggle && (
                            !isDescriptionExpanded ? (
                                <div className="pointer-events-none absolute inset-0">
                                    <div className="absolute bottom-0 right-0 h-5 w-24 pl-2 flex items-center justify-end bg-gradient-to-l from-white dark:from-gray-800/95 to-transparent">
                                        <button
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsDescriptionExpanded(true); }}
                                            className="pointer-events-auto text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 px-1"
                                            aria-label="Read more"
                                        >
                                            Read more
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsDescriptionExpanded(false); }}
                                    className="mt-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                    aria-label="Show less"
                                >
                                    Show less
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Tools (reserve row height even when absent to align cards) */}
                <div className="flex items-center gap-2 min-h-[20px] -mt-1">
                    {displayTools.length > 0 && (
                        <>
                            <div className="text-xs text-gray-400 dark:text-gray-500">
                                Tools:
                            </div>
                            <div className="flex items-center gap-1">
                                {displayTools.slice(0, 4).map((tool) => (
                                    tool.logo && (
                                        <PictureImg
                                            key={tool.name}
                                            src={tool.logo}
                                            alt={`${tool.name} logo`}
                                            className="w-4 h-4 rounded-sm object-cover flex-shrink-0"
                                            title={tool.name}
                                        />
                                    )
                                ))}
                                {displayTools.length > 4 && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                        +{displayTools.length - 4}
                                    </span>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Category Badge */}
                <div className="flex items-center justify-between">
                    <span className={clsx(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
                        getCategoryColor(category)
                    )}>
                        {category}
                    </span>
                    {loading && (
                        <div className="text-blue-600 dark:text-blue-400">
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-current"></div>
                        </div>
                    )}
                </div>

                {/* Author and interaction info */}
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                        <span>
                            {isAnonymous ? 'Anonymous' : (authorName ? (authorName.split(' ')[0] || 'Rowboat') : 'Rowboat')}
                        </span>
                        {onDelete && (
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onDelete();
                                }}
                                className="ml-1 inline-flex items-center justify-center text-gray-400 hover:text-red-600 transition-colors"
                                aria-label="Delete template"
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        )}
                        {createdAt && (
                            <div className="flex items-center gap-1">
                                <Calendar size={12} />
                                <span>{getRelativeTime(createdAt)}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        {!hideLikes && (
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onLike?.();
                                }}
                                className={clsx(
                                    "flex items-center gap-1 hover:text-red-500 transition-colors",
                                    isLiked && "text-red-500"
                                )}
                            >
                                <Heart size={14} className={isLiked ? "fill-current" : ""} />
                                <span>{likeCount || 0}</span>
                            </button>
                        )}
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCopied(true);
                                onShare?.();
                            }}
                            className="flex items-center gap-1 hover:text-blue-500 transition-colors"
                            aria-label="Copy share URL"
                        >
                            <Share2 size={14} className={copied ? "text-blue-600" : undefined} />
                            {copied && <span className="text-[10px] text-blue-600">Copied</span>}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
