import { Keyboard, Mic, MonitorUp, Video } from 'lucide-react'
import { pttKey } from '@x/shared'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isMac } from '@/lib/shortcut'

export type PermissionKind = 'microphone' | 'camera' | 'screen-recording' | 'input-monitoring'

// Where the user actually goes to fix it. The IPC handler already deep-links
// ms-settings: on Windows (see main's app:openPrivacySettings) — only the
// copy was still telling every platform to open macOS System Settings.
const OS = isMac ? 'macOS' : 'Windows'
const SETTINGS_APP = isMac ? 'System Settings' : 'Settings'
const MIC_PATH = isMac ? 'System Settings → Privacy & Security → Microphone' : 'Settings → Privacy & security → Microphone'
const CAM_PATH = isMac ? 'System Settings → Privacy & Security → Camera' : 'Settings → Privacy & security → Camera'

const COPY: Record<
  PermissionKind,
  { icon: typeof Mic; title: string; body: string; section: PermissionKind }
> = {
  microphone: {
    icon: Mic,
    title: 'Rowboat needs microphone access',
    body:
      `Voice input is off because ${OS} is blocking the microphone for Rowboat. ` +
      `Enable it under ${MIC_PATH}, then try again.`,
    section: 'microphone',
  },
  camera: {
    icon: Video,
    title: 'Rowboat needs camera access',
    body:
      `Video calls are off because ${OS} is blocking the camera for Rowboat. ` +
      `Enable it under ${CAM_PATH}, then start the call again.`,
    section: 'camera',
  },
  // Screen Recording is a macOS TCC grant; on Windows a failed capture is a
  // cancelled picker or a driver problem, not a permission to go and flip —
  // so don't send those users hunting through Settings for a switch that
  // doesn't exist (app:openPrivacySettings has no Windows deep link for it,
  // and the button is hidden below to match).
  'screen-recording': {
    icon: MonitorUp,
    title: 'Rowboat can’t see your screen',
    body: isMac
      ? 'macOS is blocking Screen Recording, so the assistant would only see black frames. ' +
        'Enable Rowboat under System Settings → Privacy & Security → Screen Recording, then ' +
        'relaunch Rowboat. If Rowboat is already enabled there, toggle it off and on — an ' +
        'updated app needs a fresh grant — and relaunch.'
      : 'Screen capture didn’t start, so the assistant can’t see your screen. If you ' +
        'dismissed the picker, just try sharing again. If it keeps failing, restart ' +
        'Rowboat — the call carries on fine without sharing.',
    section: 'screen-recording',
  },
  // Input Monitoring is macOS-only: nothing gates a global key hook on
  // Windows or Linux, so App.tsx never raises this kind there.
  'input-monitoring': {
    icon: Keyboard,
    title: 'Enable push-to-talk from any app',
    body:
      `Hold ${pttKey.pttKeyLabelCap(isMac)} to talk during a call — even while you’re in ` +
      'another app. For Rowboat to see that key outside its own window, macOS requires ' +
      'the Input Monitoring permission. Without it, push-to-talk still works while ' +
      'Rowboat is focused.',
    section: 'input-monitoring',
  },
}

/**
 * The one dialog behind every "a call feature silently did nothing" case:
 * explains which OS permission is missing, deep-links to the exact settings
 * pane (System Settings on macOS, ms-settings: on Windows), and (for input
 * monitoring) re-arms the global key hook after the user grants it.
 */
export function PermissionDialog({
  kind,
  onOpenChange,
  onRetry,
}: {
  kind: PermissionKind | null
  onOpenChange: (open: boolean) => void
  /** input-monitoring only: recreate the key hook to pick up a fresh grant. */
  onRetry?: () => void
}) {
  const copy = kind ? COPY[kind] : null
  const Icon = copy?.icon ?? Mic
  // Only offer the settings button where main can actually deep-link the
  // pane: everything on macOS, but only mic and camera on Windows (see
  // app:openPrivacySettings). A button whose handler silently returns
  // { success: false } is worse than no button.
  const hasSettingsLink = isMac || kind === 'microphone' || kind === 'camera'
  return (
    <Dialog open={kind !== null} onOpenChange={onOpenChange}>
      {/* z-[120]: share/PTT failures surface mid-call, above the z-[100]
          full-screen call view. */}
      <DialogContent className="z-[120] sm:max-w-md">
        {copy && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {copy.title}
              </DialogTitle>
              <DialogDescription className="pt-1 leading-relaxed">{copy.body}</DialogDescription>
            </DialogHeader>
            {/* Stacked, full-width buttons: uniform sizing and no label
                overflow regardless of how many actions a kind has. */}
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {hasSettingsLink && (
                <Button
                  className="w-full"
                  onClick={() => {
                    void window.ipc.invoke('app:openPrivacySettings', { section: copy.section }).catch(() => {})
                  }}
                >
                  Open {SETTINGS_APP}
                </Button>
              )}
              {kind === 'screen-recording' && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void window.ipc.invoke('app:relaunch', null).catch(() => {})}
                >
                  Relaunch Rowboat
                </Button>
              )}
              {kind === 'input-monitoring' && onRetry && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    onRetry()
                    onOpenChange(false)
                  }}
                >
                  I’ve enabled it
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
                Not now
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
