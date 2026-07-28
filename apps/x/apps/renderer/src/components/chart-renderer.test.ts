import { describe, expect, it } from 'vitest'
import { parseChartSource } from './chart-renderer'

const valid = {
  chart: 'line',
  x: 'day',
  y: 'pct',
  data: [{ day: 'Mon', pct: 0.1 }],
}

describe('parseChartSource', () => {
  it('parses a valid config', () => {
    const { config, invalid } = parseChartSource(JSON.stringify(valid))
    expect(invalid).toBe(false)
    expect(config?.chart).toBe('line')
  })

  it('treats incomplete JSON as streaming, not invalid', () => {
    const partial = JSON.stringify(valid).slice(0, 25)
    expect(parseChartSource(partial)).toEqual({ config: null, invalid: false })
  })

  it('flags complete-but-schema-invalid JSON as invalid', () => {
    const { config, invalid } = parseChartSource(
      JSON.stringify({ chart: 'line', data: [] }),
    )
    expect(config).toBeNull()
    expect(invalid).toBe(true)
  })

  it('maps the label/value pie aliases to x/y', () => {
    // Seen live: models emit pie configs with label/value field names.
    const { config, invalid } = parseChartSource(
      JSON.stringify({
        chart: 'pie',
        label: 'index',
        value: 'drop',
        data: [{ index: 'Nasdaq', drop: 2.4 }],
      }),
    )
    expect(invalid).toBe(false)
    expect(config?.x).toBe('index')
    expect(config?.y).toBe('drop')
  })

  it('accepts a y array for multi-series charts', () => {
    const { config } = parseChartSource(
      JSON.stringify({ ...valid, y: ['a', 'b'] }),
    )
    expect(config?.y).toEqual(['a', 'b'])
  })
})
