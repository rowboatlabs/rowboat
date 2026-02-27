"use client"

import { useActiveModel } from "@/hooks/useActiveModel"
import { useOAuthState } from "@/hooks/useOAuthState"
import { useUsageTracking } from "@/hooks/useUsageTracking"
import { Cpu, Zap, Shield, AlertCircle, Activity, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

// Provider display names and colors
const PROVIDER_META: Record<string, { name: string; color: string; icon: string }> = {
    openai: { name: "OpenAI", color: "text-emerald-500", icon: "🟢" },
    anthropic: { name: "Anthropic", color: "text-orange-500", icon: "🟠" },
    google: { name: "Gemini", color: "text-blue-500", icon: "🔵" },
    antigravity: { name: "Antigravity", color: "text-purple-500", icon: "🟣" },
    openrouter: { name: "OpenRouter", color: "text-pink-500", icon: "🔴" },
    ollama: { name: "Ollama", color: "text-gray-500", icon: "⚪" },
    "openai-compatible": { name: "Custom", color: "text-gray-500", icon: "⚙️" },
    aigateway: { name: "AI Gateway", color: "text-cyan-500", icon: "🔷" },
}

// Known quota/tier information
const QUOTA_INFO: Record<string, { tier: string; limits: string; type: "free" | "subscription" | "paygo" | "local" }> = {
    openai: { tier: "ChatGPT Plus", limits: "80 msgs/3h (GPT-4o)", type: "subscription" },
    anthropic: { tier: "Claude Pro/Max", limits: "Varies by model tier", type: "subscription" },
    antigravity: { tier: "Antigravity", limits: "1,500 reqs/day", type: "free" },
    google: { tier: "AI Studio", limits: "15 RPM free / 1000 RPM paid", type: "paygo" },
    openrouter: { tier: "Pay-per-token", limits: "Based on credits", type: "paygo" },
    ollama: { tier: "Local", limits: "Unlimited (hardware-bound)", type: "local" },
    "openai-compatible": { tier: "Custom API", limits: "Depends on server", type: "paygo" },
    aigateway: { tier: "Vercel Gateway", limits: "Based on plan", type: "paygo" },
}

function ConnectionDot({ connected, className }: { connected: boolean; className?: string }) {
    return (
        <span
            className={cn(
                "inline-block size-2 rounded-full",
                connected ? "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.6)]" : "bg-red-500/70",
                className
            )}
        />
    )
}

function QuotaDetails({ flavor, model }: { flavor: string; model: string }) {
    const quota = QUOTA_INFO[flavor]
    const meta = PROVIDER_META[flavor]

    if (!quota) {
        return (
            <div className="text-xs text-muted-foreground">
                No quota information available for this provider.
            </div>
        )
    }

    const typeColors: Record<string, string> = {
        free: "text-emerald-500 bg-emerald-500/10",
        subscription: "text-blue-500 bg-blue-500/10",
        paygo: "text-amber-500 bg-amber-500/10",
        local: "text-purple-500 bg-purple-500/10",
    }

    const typeLabels: Record<string, string> = {
        free: "FREE",
        subscription: "SUBSCRIPTION",
        paygo: "PAY-AS-YOU-GO",
        local: "LOCAL",
    }

    return (
        <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-base">{meta?.icon}</span>
                    <div>
                        <div className="text-sm font-medium">{meta?.name || flavor}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{model}</div>
                    </div>
                </div>
                <span className={cn(
                    "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    typeColors[quota.type]
                )}>
                    {typeLabels[quota.type]}
                </span>
            </div>

            {/* Quota info */}
            <div className="space-y-2 border-t pt-2">
                <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium">{quota.tier}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Rate Limit</span>
                    <span className="font-medium">{quota.limits}</span>
                </div>
            </div>

            {/* Antigravity-specific daily quota bar */}
            {flavor === "antigravity" && (
                <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">Daily Quota</span>
                        <span className="text-muted-foreground">Resets at midnight PT</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all"
                            style={{ width: "100%" }}
                        />
                    </div>
                    <div className="text-[10px] text-muted-foreground text-right">1,500 / 1,500 remaining</div>
                </div>
            )}
        </div>
    )
}

function UsageDetails({ usage }: { usage: { promptTokens: number; completionTokens: number; totalTokens: number; requestCount: number; sessionStart: number } }) {
    const elapsed = Date.now() - usage.sessionStart
    const minutes = Math.floor(elapsed / 60000)
    const hours = Math.floor(minutes / 60)

    const timeStr = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`

    return (
        <div className="space-y-2 border-t pt-2">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Session Usage</div>
            <div className="grid grid-cols-2 gap-2">
                <div className="text-xs">
                    <div className="text-muted-foreground">Requests</div>
                    <div className="font-medium text-sm">{usage.requestCount}</div>
                </div>
                <div className="text-xs">
                    <div className="text-muted-foreground">Duration</div>
                    <div className="font-medium text-sm">{timeStr}</div>
                </div>
                <div className="text-xs">
                    <div className="text-muted-foreground">Input Tokens</div>
                    <div className="font-medium text-sm">{usage.promptTokens.toLocaleString()}</div>
                </div>
                <div className="text-xs">
                    <div className="text-muted-foreground">Output Tokens</div>
                    <div className="font-medium text-sm">{usage.completionTokens.toLocaleString()}</div>
                </div>
            </div>
            {usage.totalTokens > 0 && (
                <div className="flex items-center justify-between text-xs border-t pt-1.5">
                    <span className="text-muted-foreground">Total Tokens</span>
                    <span className="font-semibold">{usage.totalTokens.toLocaleString()}</span>
                </div>
            )}
        </div>
    )
}

export function StatusBar() {
    const { modelName, flavor } = useActiveModel()
    const { isConnected, supportsOAuth } = useOAuthState()
    const { usage, getQuotaInfo } = useUsageTracking()

    const meta = PROVIDER_META[flavor || ""] || { name: flavor || "Unknown", color: "text-gray-500", icon: "❓" }
    const connected = flavor ? (supportsOAuth(flavor) ? isConnected(flavor) : true) : false
    const quotaInfo = flavor && modelName ? getQuotaInfo(flavor, modelName) : null

    return (
        <div className="h-6 bg-background border-t flex items-center px-2 gap-3 text-[11px] select-none shrink-0">
            {/* Model + Provider */}
            <Popover>
                <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 hover:bg-accent rounded px-1.5 py-0.5 transition-colors group">
                        <Cpu className="size-3 text-muted-foreground" />
                        <span className={cn("font-medium", meta.color)}>
                            {modelName || "No model"}
                        </span>
                        <ConnectionDot connected={connected} />
                        <ChevronUp className="size-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-72 p-3">
                    {flavor && modelName ? (
                        <div className="space-y-3">
                            <QuotaDetails flavor={flavor} model={modelName} />
                            <UsageDetails usage={usage} />
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground text-center py-4">
                            No model configured. Open Settings to set up a provider.
                        </div>
                    )}
                </PopoverContent>
            </Popover>

            {/* Divider */}
            <div className="h-3 w-px bg-border" />

            {/* Connection status */}
            <div className="flex items-center gap-1 text-muted-foreground">
                {connected ? (
                    <>
                        <Shield className="size-3 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400">
                            {supportsOAuth(flavor || "") ? "OAuth" : "API Key"}
                        </span>
                    </>
                ) : flavor && supportsOAuth(flavor) ? (
                    <>
                        <AlertCircle className="size-3 text-amber-500" />
                        <span className="text-amber-600 dark:text-amber-400">Not connected</span>
                    </>
                ) : (
                    <>
                        <Shield className="size-3" />
                        <span>Ready</span>
                    </>
                )}
            </div>

            {/* Divider */}
            <div className="h-3 w-px bg-border" />

            {/* Quota indicator */}
            {quotaInfo && (
                <div className="flex items-center gap-1 text-muted-foreground">
                    <Zap className="size-3" />
                    <span>{quotaInfo.tier}</span>
                </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Usage summary */}
            {usage.requestCount > 0 && (
                <div className="flex items-center gap-1 text-muted-foreground">
                    <Activity className="size-3" />
                    <span>
                        {usage.totalTokens > 0
                            ? `${usage.totalTokens.toLocaleString()} tokens`
                            : `${usage.requestCount} req${usage.requestCount !== 1 ? "s" : ""}`}
                    </span>
                </div>
            )}
        </div>
    )
}
