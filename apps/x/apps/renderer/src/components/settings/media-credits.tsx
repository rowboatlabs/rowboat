import { useState } from 'react'
import type { MediaCredits, MediaPack } from '@x/shared/dist/billing.js'
import { Button } from '@/components/ui/button'
import { MEDIA, costRanges, entryLabel, priceText, when } from '@/lib/media-credits'

// Settings › Usage, the media part (Baarali, 03/10/2026, validated mockup):
// the media credits left and what they went to, the packs to top up with,
// and what each kind of media costs. Payment is not open yet: the packs are
// shown with their prices, the button says « Coming soon ».

function Pack({ pack, selected, onSelect }: { pack: MediaPack; selected: boolean; onSelect: () => void }) {
  const eur = pack.prices.find((p) => p.currency === 'EUR')
  const cfa = pack.prices.find((p) => p.currency === 'XOF')
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ${selected ? 'border-primary bg-primary/5' : 'hover:bg-accent'}`}>
      {eur && <span className="text-base font-semibold tabular-nums">{priceText(eur.amount, eur.currency)}</span>}
      {cfa && <span className="text-[12px] tabular-nums text-muted-foreground">{priceText(cfa.amount, cfa.currency)}</span>}
      <span className="text-[12px] tabular-nums text-muted-foreground">{`${pack.credits} credits`}</span>
    </button>
  )
}

export function MediaCreditsPanel({ media }: { media: MediaCredits }) {
  const [showAll, setShowAll] = useState(false)
  const [pick, setPick] = useState(media.packs[1]?.id ?? media.packs[0]?.id ?? null)
  const history = showAll ? media.history : media.history.slice(0, 5)
  const ranges = costRanges(media.costs)
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="space-y-3 rounded-lg border p-4">
          <h4 className="text-sm font-semibold">Media credits</h4>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{media.balance}</span>
            <span className="text-sm text-muted-foreground">credits</span>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            For images, videos and voices. They do not expire and do not touch your session or your week.
          </p>
          {media.history.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No media credits used yet.</p>
          ) : (
            <table className="w-full text-[12.5px] tabular-nums">
              <tbody>
                {history.map((e, i) => (
                  <tr key={`${e.at}-${i}`} className="border-t">
                    <td className="py-1.5 pr-2">{entryLabel(e)}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{when.format(Date.parse(e.at))}</td>
                    <td className={`py-1.5 text-right ${e.credits > 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}`}>
                      {e.credits > 0 ? `+${e.credits}` : `${e.credits}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {media.history.length > 5 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="text-[12.5px] text-primary hover:underline">
              {showAll ? 'Show less' : 'Show all history'}
            </button>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h4 className="text-sm font-semibold">Top up</h4>
          {media.packs.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {media.packs.map((pack) => (
                <Pack key={pack.id} pack={pack} selected={pick === pack.id} onSelect={() => setPick(pack.id)} />
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pay with</p>
            <div className="flex flex-wrap gap-1.5">
              {['Orange Money', 'Moov Money', 'Wave', 'Card'].map((way) => (
                <span key={way} className="rounded-full border px-2.5 py-0.5 text-[12px]">{way}</span>
              ))}
            </div>
          </div>
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
            Payment is not open yet. Until then, credits are added by hand.
          </p>
          <Button size="sm" disabled>Coming soon</Button>
        </section>
      </div>

      {ranges.length > 0 && (
        <section className="space-y-2 rounded-lg border p-4">
          <h4 className="text-sm font-semibold">What each thing costs</h4>
          <table className="w-full text-[12.5px] tabular-nums">
            <tbody>
              <tr className="border-t">
                <td className="py-1.5 pr-2">Messages, summaries, emails, scheduled tasks</td>
                <td className="py-1.5 text-right text-muted-foreground">Count in the session and the week</td>
              </tr>
              {ranges.map((r) => (
                <tr key={r.kind} className="border-t">
                  <td className="py-1.5 pr-2">{MEDIA[r.kind] ?? r.kind}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
