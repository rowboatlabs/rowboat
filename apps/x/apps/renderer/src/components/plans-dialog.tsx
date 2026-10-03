import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import type { BillingInfo, PlanOffer, PlanOffers } from '@x/shared/src/billing.js'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { closePlans, isPlansOpen, openPlans, subscribePlans } from '@/lib/plans-window'
import { weekResetText } from '@/lib/usage-reset'
import { cn } from '@/lib/utils'

// The plans, inside the app (Baarali, 02/10/2026). Words and prices come
// from the control plane (GET /v1/plans), the same as baarali.com/tarifs:
// this window only lays them out. Payment is not open yet, so a paid plan
// says so rather than send anyone anywhere.

type Currency = 'xof' | 'eur'

const CURRENCY_KEY = 'baarali.plans.currency'

function storedCurrency(): Currency {
    try {
        return window.localStorage.getItem(CURRENCY_KEY) === 'eur' ? 'eur' : 'xof'
    } catch {
        return 'xof'
    }
}

export function PlansDialog() {
    const open = useSyncExternalStore(subscribePlans, isPlansOpen)
    const [offers, setOffers] = useState<PlanOffers | null>(null)
    const [failed, setFailed] = useState(false)
    const [billing, setBilling] = useState<BillingInfo | null>(null)
    const [currency, setCurrency] = useState<Currency>(storedCurrency)

    useEffect(() => {
        if (!open) return
        let live = true
        void window.ipc.invoke('billing:getPlans', { lang: 'fr' }).then(
            (result) => {
                if (!live) return
                setOffers(result)
                setFailed(result === null)
            },
            () => live && setFailed(true),
        )
        void window.ipc.invoke('billing:getInfo', null).then(
            (result) => live && setBilling(result),
            () => live && setBilling(null),
        )
        return () => {
            live = false
        }
    }, [open])

    const pick = (next: Currency) => {
        setCurrency(next)
        try {
            window.localStorage.setItem(CURRENCY_KEY, next)
        } catch {
            // a remembered choice only
        }
    }

    const currentId = billing?.subscriptionPlanId ?? null
    const weekPct = billing && billing.monthly.sanctionedCredits > 0
        ? Math.min(100, Math.round((billing.monthly.usedCredits / billing.monthly.sanctionedCredits) * 100))
        : null
    const renews = billing ? weekResetText(billing.monthly.resetsAt) : undefined

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? openPlans() : closePlans())}>
            <DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-[1080px]">
                <div className="flex flex-wrap items-end justify-between gap-4 pr-8">
                    <div className="space-y-1.5">
                        <DialogTitle className="text-xl">Plans</DialogTitle>
                        <DialogDescription>{offers?.lead ?? 'Your usage renews every 5 hours and every week.'}</DialogDescription>
                    </div>
                    <div role="radiogroup" aria-label="Currency" className="flex rounded-full border bg-muted/40 p-0.5">
                        {(['xof', 'eur'] as const).map((c) => (
                            <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={currency === c}
                                onClick={() => pick(c)}
                                className={cn(
                                    'rounded-full px-3.5 py-1 text-xs font-semibold text-muted-foreground transition-colors',
                                    currency === c && 'bg-background text-foreground shadow-sm',
                                )}
                            >
                                {c === 'xof' ? 'CFA francs' : 'Euros'}
                            </button>
                        ))}
                    </div>
                </div>

                {offers ? (
                    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                        {offers.plans.map((plan) => (
                            <PlanCard key={plan.id} plan={plan} currency={currency} currentId={currentId} soon={offers.soon} />
                        ))}
                    </div>
                ) : (
                    <p className="py-16 text-center text-sm text-muted-foreground">
                        {failed ? 'The plans could not be loaded. Check your connection and try again.' : 'Loading plans…'}
                    </p>
                )}

                <div className="flex flex-wrap justify-between gap-2 border-t pt-3.5 text-xs text-muted-foreground">
                    <span>{offers?.foot}</span>
                    {weekPct !== null && (
                        <span>
                            {`This week: ${weekPct}% used`}
                            {renews ? ` · ${renews}` : ''}
                        </span>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function PlanCard({ plan, currency, currentId, soon }: {
    plan: PlanOffer
    currency: Currency
    currentId: string | null
    soon: string
}) {
    const mineIndex = plan.levels.findIndex((l) => l.id === currentId)
    const [levelIndex, setLevelIndex] = useState(Math.max(0, mineIndex))
    const level = plan.levels[levelIndex] ?? plan.levels[0]
    const mine = mineIndex >= 0
    const other: Currency = currency === 'xof' ? 'eur' : 'xof'

    return (
        <article
            className={cn(
                'flex flex-col gap-2.5 rounded-xl border bg-muted/20 p-4',
                plan.featured && 'border-primary',
            )}
        >
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                <span>{plan.tag}</span>
                {mine && (
                    <span className="flex items-center gap-1 text-primary">
                        <span className="size-1.5 rounded-full bg-primary" />
                        Your plan
                    </span>
                )}
            </div>
            <h3 className="text-lg font-semibold">{plan.name}</h3>

            {plan.levels.length > 1 && (
                <div role="radiogroup" aria-label={plan.name} className="flex gap-1.5">
                    {plan.levels.map((l, i) => (
                        <button
                            key={l.id}
                            type="button"
                            role="radio"
                            aria-checked={i === levelIndex}
                            onClick={() => setLevelIndex(i)}
                            className={cn(
                                'flex-1 rounded-md border px-2 py-1 text-xs text-muted-foreground',
                                i === levelIndex && 'border-primary text-foreground',
                            )}
                        >
                            {l.label}
                        </button>
                    ))}
                </div>
            )}

            <div>
                <p className="text-2xl font-bold tracking-tight">
                    {level.price ? level.price[currency] : plan.free ? 'Free' : ''}
                    <span className="ml-1.5 text-xs font-medium text-muted-foreground">{level.per}</span>
                </p>
                <p className="min-h-4 text-xs text-muted-foreground">
                    {[level.price?.[other], level.note].filter(Boolean).join(' · ')}
                </p>
            </div>
            <p className="min-h-10 text-[13px] text-muted-foreground">{plan.for}</p>

            <button
                type="button"
                disabled
                className={cn(
                    'rounded-full border py-2 text-sm font-semibold',
                    mine ? 'text-foreground' : 'text-muted-foreground',
                )}
            >
                {mine ? 'Current plan' : plan.free ? 'Included' : soon}
            </button>

            <p className="mt-1 text-xs font-semibold text-muted-foreground">{plan.plus}</p>
            <ul className="grid gap-1.5 text-[13px]">
                {plan.points.map((point) => (
                    <li key={point} className="flex gap-2">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span>{point}</span>
                    </li>
                ))}
            </ul>
        </article>
    )
}
