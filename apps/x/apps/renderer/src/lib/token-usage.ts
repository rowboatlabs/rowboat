import type { TokenUsage } from '@/lib/chat-conversation'

const USAGE_KEYS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'reasoningTokens',
  'cachedInputTokens',
] as const

export function addTokenUsage(total: TokenUsage, usage: TokenUsage): TokenUsage {
  const next = { ...total }
  for (const key of USAGE_KEYS) {
    const value = usage[key]
    if (value !== undefined) {
      next[key] = (next[key] ?? 0) + value
    }
  }
  return next
}

export function hasTokenUsage(usage: TokenUsage | undefined): usage is TokenUsage {
  return !!usage && USAGE_KEYS.some((key) => (usage[key] ?? 0) > 0)
}

export function totalTokensOf(usage: TokenUsage): number {
  return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

export function formatTokenCount(tokens: number | undefined): string {
  if (tokens === undefined) return '-'
  return new Intl.NumberFormat('en-US', { notation: 'compact' }).format(tokens)
}
