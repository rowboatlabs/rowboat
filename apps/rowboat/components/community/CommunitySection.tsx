'use client';

import React, { useState, useEffect } from 'react';
import { AssistantSection } from '@/components/common/AssistantSection';
import { useRouter } from 'next/navigation';
import { createProjectFromJsonWithOptions } from '@/app/projects/lib/project-creation-utils';

interface CommunityAssistant {
    id: string;
    name: string;
    description: string;
    category: string;
    authorId: string;
    authorName: string;
    authorEmail?: string | null;
    isAnonymous: boolean;
    workflow: any;
    tags: string[];
    publishedAt: string;
    lastUpdatedAt: string;
    downloadCount: number;
    likeCount: number;
    featured: boolean;
    isPublic: boolean;
    likes: string[];
    copilotPrompt?: string;
    thumbnailUrl?: string | null;
}

interface CommunitySectionProps {
    onImport?: (assistant: CommunityAssistant) => void;
}

export function CommunitySection({ onImport }: CommunitySectionProps) {
    const [assistants, setAssistants] = useState<CommunityAssistant[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
    const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
    const router = useRouter();

    // Fetch community assistants
    const fetchAssistants = async (filters?: { searchQuery: string; selectedCategory: string }) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (filters?.searchQuery) params.append('search', filters.searchQuery);
            if (filters?.selectedCategory) params.append('category', filters.selectedCategory);
            params.append('source', 'community');
            const url = `/api/assistant-templates?${params}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch assistants');
            
            const data = await response.json();
            setAssistants(data.items || []);
        } catch (err) {
            console.error('Error fetching assistants:', err);
            setError(err instanceof Error ? err.message : 'Failed to load assistants');
        } finally {
            setLoading(false);
        }
    };

    // Load guest likes from session storage
    const loadGuestLikes = () => {
        try {
            const stored = sessionStorage.getItem('guestLikes');
            if (stored) {
                const likes = JSON.parse(stored);
                setLikedIds(new Set(likes));
            }
        } catch (err) {
            console.error('Error loading guest likes:', err);
        }
    };

    // Save guest likes to session storage
    const saveGuestLikes = (likes: Set<string>) => {
        try {
            sessionStorage.setItem('guestLikes', JSON.stringify(Array.from(likes)));
        } catch (err) {
            console.error('Error saving guest likes:', err);
        }
    };

    // Get or create consistent guest ID
    const getGuestId = () => {
        try {
            let guestId = sessionStorage.getItem('guestId');
            if (!guestId) {
                guestId = `guest-${crypto.randomUUID()}`;
                sessionStorage.setItem('guestId', guestId);
            }
            return guestId;
        } catch (err) {
            // Fallback if sessionStorage is not available
            return `guest-${crypto.randomUUID()}`;
        }
    };

    // Handle like toggle
    const handleLike = async (item: any) => {
        const assistant = assistants.find(a => a.id === item.id);
        if (!assistant) return;

        try {
            const guestId = getGuestId();
            const response = await fetch(`/api/assistant-templates/${assistant.id}/like`, {
                method: 'POST',
                headers: {
                    'x-guest-id': guestId,
                },
            });

            if (response.ok) {
                const data = await response.json();
                setLikedIds(prev => {
                    const newSet = new Set(prev);
                    if (data.liked) {
                        newSet.add(assistant.id);
                    } else {
                        newSet.delete(assistant.id);
                    }
                    saveGuestLikes(newSet);
                    return newSet;
                });
                
                // Update the assistant's like count
                setAssistants(prev => prev.map(a => 
                    a.id === assistant.id 
                        ? { ...a, likeCount: data.likeCount }
                        : a
                ));
            }
        } catch (err) {
            console.error('Error toggling like:', err);
        }
    };

    // Handle share
    const handleShare = (item: any) => {
        const assistant = assistants.find(a => a.id === item.id);
        if (!assistant) return;

        const url = `${window.location.origin}/assistant-templates/${assistant.id}`;
        navigator.clipboard.writeText(url).then(() => {
            // You could add a toast notification here
            console.log('URL copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy URL:', err);
        });
    };

    // Handle import
    const handleImport = async (item: any) => {
        const assistant = assistants.find(a => a.id === item.id);
        if (!assistant) return;

        if (onImport) {
            onImport(assistant);
            return;
        }

        setImportingIds(prev => new Set(prev).add(assistant.id));
        try {
            const response = await fetch(`/api/community-assistants/${assistant.id}`);
            if (!response.ok) throw new Error('Failed to fetch assistant details');
            
            const data = await response.json();
            
            await createProjectFromJsonWithOptions({
                workflowJson: JSON.stringify(data.workflow),
                router,
                onSuccess: (projectId) => {
                    router.push(`/projects/${projectId}/workflow`);
                },
                onError: (error) => {
                    console.error('Error creating project:', error);
                }
            });
        } catch (err) {
            console.error('Error importing assistant:', err);
            // You could add error handling here
        } finally {
            setImportingIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(assistant.id);
                return newSet;
            });
        }
    };

    // Load data on mount
    useEffect(() => {
        fetchAssistants();
        loadGuestLikes();
    }, []);

    return (
        <AssistantSection
            title="Community Assistants"
            description="Discover and use assistants created by the community."
            items={assistants.map(assistant => ({
                id: assistant.id,
                name: assistant.name,
                description: assistant.description,
                category: assistant.category,
                authorName: assistant.authorName,
                isAnonymous: assistant.isAnonymous,
                likeCount: assistant.likeCount,
                createdAt: assistant.publishedAt,
                isLiked: likedIds.has(assistant.id)
            }))}
            loading={loading}
            error={error}
            onItemClick={handleImport}
            onRetry={() => fetchAssistants()}
            loadingItemId={Array.from(importingIds)[0] || null}
            emptyMessage="No community assistants available"
            onLike={handleLike}
            onShare={handleShare}
        />
    );
}