import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import posthog, { type CaptureResult, type PostHog, type PostHogConfig } from 'posthog-js'

const { render, invoke } = vi.hoisted(() => ({ render: vi.fn(), invoke: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render }) }))
vi.mock('./App.tsx', () => ({ default: () => null }))
vi.mock('posthog-js/react', () => ({ PostHogProvider: () => null }))
vi.mock('@/contexts/theme-context', () => ({ ThemeProvider: () => null }))
vi.mock('./lib/analytics', () => ({ configureAnalyticsContext: vi.fn() }))
vi.mock('@/components/meeting-detected-popup', () => ({ MeetingDetectedPopup: () => null }))
vi.mock('@/components/quick-ask-bar', () => ({ QuickAskBar: () => null }))
vi.mock('@/components/screen-pointer-overlay', () => ({ ScreenPointerOverlay: () => null }))

describe('renderer analytics consent bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    render.mockClear()
    invoke.mockReset()
    vi.useFakeTimers()
    vi.stubGlobal('ipc', { invoke })
    document.body.innerHTML = '<div id="root"></div>'
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function bootstrap() {
    await import('./main')
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1))
    return render.mock.calls[0][0].props.children.props.options as Partial<PostHogConfig>
  }

  it.each([true, false])('applies persisted consent before capture (enabled=%s)', async (enabled) => {
    invoke.mockResolvedValue({ analyticsEnabled: enabled, installationId: 'test-installation' })
    const options = await bootstrap()
    expect(options.opt_out_capturing_by_default).toBe(!enabled)
    const client = { opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn() }
    options.loaded!(client as unknown as PostHog)
    if (enabled) {
      expect(client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false })
      expect(client.opt_out_capturing).not.toHaveBeenCalled()
    } else {
      expect(client.opt_out_capturing).toHaveBeenCalledOnce()
      expect(client.opt_in_capturing).not.toHaveBeenCalled()
    }
  })

  it('keeps capture disabled when settings cannot be loaded', async () => {
    invoke.mockRejectedValue(new Error('IPC unavailable'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const options = await bootstrap()
    expect(options.opt_out_capturing_by_default).toBe(true)
  })
  it('honours telemetry opt-out even when analyticsEnabled is true', async () => {
    invoke.mockResolvedValue({ analyticsEnabled: true, telemetryOptOut: true })
    const options = await bootstrap()
    expect(options.opt_out_capturing_by_default).toBe(true)
    const client = { opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn() }
    options.loaded!(client as unknown as PostHog)
    expect(client.opt_out_capturing).toHaveBeenCalledOnce()
    expect(client.opt_in_capturing).not.toHaveBeenCalled()
  })

  it('uses live consent so opting back in does not require a restart', async () => {
    invoke.mockResolvedValue({ analyticsEnabled: false, telemetryOptOut: true })
    const options = await bootstrap()
    const consent = vi.spyOn(posthog, 'has_opted_out_capturing')
    const beforeSend = options.before_send as (event: CaptureResult | null) => CaptureResult | null
    const event = { properties: {} } as CaptureResult
    consent.mockReturnValue(true)
    expect(beforeSend(event)).toBeNull()
    consent.mockReturnValue(false)
    expect(beforeSend(event)).toBe(event)
  })

})
