export const skill = String.raw`
# Charts

Load this skill when the user asks for a chart, graph, plot, trend, comparison, or "visualize" — or when data you've gathered (prices over time, counts per category, proportions) would land better as a picture than a table.

## How it works

Emit a fenced code block with language \`chart\` anywhere in your reply. The app renders it as an interactive chart inline (tooltips, legend, light/dark theming are handled for you — never pick colors yourself). Everything outside the fence is normal markdown.

\`\`\`\`
\`\`\`chart
{ ...JSON config... }
\`\`\`
\`\`\`\`

## Config schema

The ONLY fields are \`chart\`, \`data\`, \`x\`, \`y\`, \`title\` — nothing else exists (no \`label\`, \`value\`, \`series\`, \`color\`, etc.). Unknown fields are ignored; a missing \`x\` or \`y\` breaks the chart.

- **\`chart\`** (required): \`"line"\` | \`"bar"\` | \`"pie"\`
- **\`data\`** (required): array of flat objects — the rows to plot. Put REAL values you gathered this turn here; never invent numbers.
- **\`x\`** (required): key of the label/category field in each row. For pie: the slice-name key.
- **\`y\`** (required): key of the value field — a string for one series, or an array of keys for several series on one chart. For pie: the slice-value key.
- **\`title\`** (optional): short heading shown above the chart

**Data must be wide-format**: one row per x value, one key per series. Never long/tidy format (a row per series-point with a series-name column) — multiple series means multiple keys in the SAME row:

WRONG: \`[{ "day": "Mon", "index": "S&P", "pct": 0.1 }, { "day": "Mon", "index": "Dow", "pct": 0.2 }]\`
RIGHT: \`[{ "day": "Mon", "S&P": 0.1, "Dow": 0.2 }]\` with \`"y": ["S&P", "Dow"]\`

## Picking the form

- **line** — change over time (prices, counts by date). X is the time field.
- **bar** — compare magnitudes across categories (issues per label, revenue per region).
- **pie** — proportions of a whole; only with ≤ 6 slices, otherwise use a bar.
- Two measures with very different scales (e.g. a $600 stock vs a $5 one): do NOT mix them on one chart — either normalize to % change and say so in the title, or emit two chart blocks.

## Examples

Multi-series line (comparison over time, normalized):

\`\`\`chart
{
  "chart": "line",
  "title": "5-Day % Change",
  "x": "date",
  "y": ["AAPL", "NVDA", "SPY"],
  "data": [
    { "date": "Jul 15", "AAPL": 0, "NVDA": 0, "SPY": 0 },
    { "date": "Jul 16", "AAPL": -0.4, "NVDA": 1.2, "SPY": 0.1 },
    { "date": "Jul 17", "AAPL": -1.1, "NVDA": 0.8, "SPY": -0.3 }
  ]
}
\`\`\`

Single-series bar:

\`\`\`chart
{
  "chart": "bar",
  "title": "Open issues by area",
  "x": "area",
  "y": "count",
  "data": [
    { "area": "sync", "count": 14 },
    { "area": "editor", "count": 9 },
    { "area": "billing", "count": 3 }
  ]
}
\`\`\`

Pie (x names the slice, y is its value — same keys as every other chart):

\`\`\`chart
{
  "chart": "pie",
  "title": "Time spent by project",
  "x": "project",
  "y": "hours",
  "data": [
    { "project": "Alpha", "hours": 14 },
    { "project": "Beta", "hours": 6 },
    { "project": "Internal", "hours": 3 }
  ]
}
\`\`\`

## Rules

- Data must come from what you actually fetched or computed this turn — never fabricate points to make a chart possible. Too little real data? Say so instead of charting.
- Keep it readable: ≤ ~30 rows per chart, ≤ 6 series. Round values sensibly.
- Numbers must be JSON numbers, not strings ("3.1", "5%" won't plot).
- Follow the chart with one sentence of takeaway — what the reader should see in it.
- One chart per distinct question; don't emit several variants of the same data.
`;

export default skill;
