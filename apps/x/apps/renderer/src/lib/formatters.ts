// ─── Shared Intl formatters ──────────────────────────────
// Reuse a single formatter instance per style to avoid
// allocating new Intl.NumberFormat objects on every render.

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
})

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
})

export const formatCurrency = (value: number) => currencyFmt.format(value)
export const formatPercent = (value: number) => percentFmt.format(value)
export const formatCompact = (value: number) => compactFmt.format(value)
