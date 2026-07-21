import { useMemo } from 'react'
import { BarChart3 } from 'lucide-react'
import { blocks } from '@x/shared'
import { useTheme } from '@/contexts/theme-context'
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

// Categorical palettes validated for CVD separation and surface contrast on
// each mode's chart surface (dataviz six-checks validator). Slots are
// assigned to series in fixed order — the dark column is the same hues
// re-stepped for the dark surface, not a different palette.
const SERIES_COLORS_LIGHT = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834']
const SERIES_COLORS_DARK = ['#3987e5', '#008300', '#d55181', '#c98500', '#199e70', '#d95926']

interface ChartRendererProps {
  /** Raw contents of a ```chart fence: ChartBlockSchema JSON. */
  source: string
}

/**
 * Inline chart for chat messages: renders a ```chart fenced block (same
 * ChartBlockSchema the notes chart block uses) via recharts. Invalid or
 * still-streaming JSON renders as a quiet placeholder rather than an error —
 * the fence body arrives token by token while the model writes it.
 */
export function ChartRenderer({ source }: ChartRendererProps) {
  const { resolvedTheme } = useTheme()
  const colors = resolvedTheme === 'dark' ? SERIES_COLORS_DARK : SERIES_COLORS_LIGHT
  const gridStroke = resolvedTheme === 'dark' ? '#3a3a38' : '#e4e4e0'
  const textColor = resolvedTheme === 'dark' ? '#c3c2b7' : '#52514e'

  const { config, invalid } = useMemo(() => {
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      // Incomplete JSON — the fence body is still streaming in.
      return { config: null, invalid: false }
    }
    // Models occasionally reach for pie-flavored field names despite the
    // skill's schema; map the predictable aliases before validating.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      if (obj.x === undefined && typeof obj.label === 'string') obj.x = obj.label
      if (obj.y === undefined && typeof obj.value === 'string') obj.y = obj.value
    }
    const result = blocks.ChartBlockSchema.safeParse(parsed)
    return result.success
      ? { config: result.data, invalid: false }
      : { config: null, invalid: true }
  }, [source])

  // Complete JSON that fails the schema is a real error — say so instead of
  // showing the streaming placeholder forever.
  if (invalid || (config && (!config.data || config.data.length === 0))) {
    return (
      <div className="my-2 flex h-24 items-center justify-center gap-2 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
        <BarChart3 className="size-3.5" />
        {invalid ? 'Chart config invalid — ask me to redraw it' : 'Chart has no data'}
      </div>
    )
  }
  if (!config) {
    return (
      <div className="my-2 flex h-24 items-center justify-center gap-2 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
        <BarChart3 className="size-3.5" />
        Preparing chart…
      </div>
    )
  }

  const data = config.data ?? []
  const series = blocks.chartSeries(config)
  const axisProps = {
    stroke: textColor,
    tick: { fill: textColor, fontSize: 11 },
    tickLine: false,
  }

  return (
    <div className="my-2 rounded-md border border-border bg-card p-3">
      {config.title && (
        <div className="mb-2 text-sm font-medium text-foreground">{config.title}</div>
      )}
      <ResponsiveContainer width="100%" height={260}>
        {config.chart === 'line' ? (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey={config.x} {...axisProps} />
            <YAxis {...axisProps} width={44} />
            <Tooltip
              contentStyle={{
                backgroundColor: resolvedTheme === 'dark' ? '#1a1a19' : '#fcfcfb',
                border: `1px solid ${gridStroke}`,
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                dot={{ r: 2.5 }}
              />
            ))}
          </LineChart>
        ) : config.chart === 'bar' ? (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey={config.x} {...axisProps} />
            <YAxis {...axisProps} width={44} />
            <Tooltip
              cursor={{ fill: resolvedTheme === 'dark' ? '#ffffff14' : '#00000009' }}
              contentStyle={{
                backgroundColor: resolvedTheme === 'dark' ? '#1a1a19' : '#fcfcfb',
                border: `1px solid ${gridStroke}`,
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                fill={colors[i % colors.length]}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        ) : (
          <PieChart>
            <Tooltip
              contentStyle={{
                backgroundColor: resolvedTheme === 'dark' ? '#1a1a19' : '#fcfcfb',
                border: `1px solid ${gridStroke}`,
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Pie
              data={data}
              dataKey={series[0]}
              nameKey={config.x}
              cx="50%"
              cy="50%"
              outerRadius={90}
              stroke={resolvedTheme === 'dark' ? '#1a1a19' : '#fcfcfb'}
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
