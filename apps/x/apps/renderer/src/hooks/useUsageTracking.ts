import { useState, useCallback, useRef, useEffect } from 'react';

export interface UsageStats {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requestCount: number;
    sessionStart: number; // Unix timestamp
}

export interface QuotaInfo {
    provider: string;
    model: string;
    tier: string;
    dailyLimit?: number;
    dailyUsed?: number;
    rateLimit?: string;
    resetTime?: string;
}

// Known quota tiers for subscription-based providers
const QUOTA_TIERS: Record<string, { tier: string; dailyLimit?: number; rateLimit?: string }> = {
    'openai': { tier: 'ChatGPT Plus', rateLimit: '80 msgs/3h (GPT-4o)' },
    'anthropic': { tier: 'Claude Pro/Max', rateLimit: '45 msgs/5h (Opus), unlimited (Sonnet)' },
    'antigravity': { tier: 'Antigravity Free', dailyLimit: 1500, rateLimit: '1500 reqs/day' },
    'google': { tier: 'Google AI Studio', rateLimit: '15 RPM (Free), 1000 RPM (Paid)' },
    'openrouter': { tier: 'Pay-per-token', rateLimit: 'Based on account credits' },
    'ollama': { tier: 'Local (Unlimited)', rateLimit: 'Hardware-limited' },
};

/**
 * Hook to track token usage and quota information for the active model.
 */
export function useUsageTracking() {
    const [usage, setUsage] = useState<UsageStats>({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        sessionStart: Date.now(),
    });

    const usageRef = useRef(usage);
    usageRef.current = usage;

    /**
     * Record token usage from a completed AI request
     */
    const recordUsage = useCallback((tokens: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    }) => {
        setUsage(prev => ({
            ...prev,
            promptTokens: prev.promptTokens + (tokens.promptTokens || 0),
            completionTokens: prev.completionTokens + (tokens.completionTokens || 0),
            totalTokens: prev.totalTokens + (tokens.totalTokens || 0),
            requestCount: prev.requestCount + 1,
        }));
    }, []);

    /**
     * Reset usage stats (e.g., on session change)
     */
    const resetUsage = useCallback(() => {
        setUsage({
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            requestCount: 0,
            sessionStart: Date.now(),
        });
    }, []);

    /**
     * Get quota information for a given provider and model
     */
    const getQuotaInfo = useCallback((provider: string, model: string): QuotaInfo => {
        const tierInfo = QUOTA_TIERS[provider] || { tier: 'Unknown', rateLimit: 'N/A' };

        return {
            provider,
            model,
            tier: tierInfo.tier,
            dailyLimit: tierInfo.dailyLimit,
            rateLimit: tierInfo.rateLimit,
        };
    }, []);

    /**
     * Format a usage summary for display
     */
    const getUsageSummary = useCallback((): string => {
        const u = usageRef.current;
        if (u.requestCount === 0) return 'No requests yet';

        const parts: string[] = [];
        if (u.totalTokens > 0) {
            parts.push(`${u.totalTokens.toLocaleString()} tokens`);
        }
        parts.push(`${u.requestCount} ${u.requestCount === 1 ? 'request' : 'requests'}`);

        const elapsed = Date.now() - u.sessionStart;
        const minutes = Math.floor(elapsed / 60000);
        if (minutes > 0) {
            parts.push(`${minutes}m session`);
        }

        return parts.join(' · ');
    }, []);

    // Listen for usage events from runs
    useEffect(() => {
        const handleRunEvent = (event: CustomEvent) => {
            const detail = event.detail;
            if (detail?.usage) {
                recordUsage(detail.usage);
            }
        };

        window.addEventListener('run:usage' as any, handleRunEvent);
        return () => window.removeEventListener('run:usage' as any, handleRunEvent);
    }, [recordUsage]);

    return {
        usage,
        recordUsage,
        resetUsage,
        getQuotaInfo,
        getUsageSummary,
    };
}
