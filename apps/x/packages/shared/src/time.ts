/**
 * Format a timestamp into the user's local timezone for any text shown to the
 * LLM (tool output, knowledge markdown, thread summaries). External sources
 * carry their own offsets — email `Date:` headers are typically `+0000`, Slack
 * uses epoch seconds, calendar APIs return UTC ISO strings. Handed to the model
 * raw, it quotes them verbatim instead of converting — e.g. a 1:06 PM IST email
 * described as "7:36 AM" in chat. Call this at every model-facing serialization
 * boundary; the model's tendency to quote timestamps verbatim then produces
 * correct output. The weekday is included because models are unreliable at
 * day-of-week arithmetic. Uses the system timezone of the process it runs in.
 *
 * NOT for structured `date` fields that code later parses with `new Date(...)`
 * — those must stay raw parseable values.
 *
 * Accepts a raw date string, epoch milliseconds, or a Date. Unparseable
 * strings (e.g. 'Unknown') are returned unchanged; null/undefined and invalid
 * Date/number inputs return ''.
 */
export function formatTimestampForModel(raw: string | number | Date | undefined | null): string {
    if (raw === undefined || raw === null || raw === '') return '';
    const parsed = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return typeof raw === 'string' ? raw : '';
    }
    return parsed.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    });
}
