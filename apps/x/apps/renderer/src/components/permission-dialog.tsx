import { Keyboard, Mic, MonitorUp, Video } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type PermissionKind = 'microphone' | 'camera' | 'screen-recording' | 'input-monitoring'

const COPY: Record<
  PermissionKind,
  { icon: typeof Mic; title: string; body: string; section: PermissionKind }
> = {
  microphone: {
    icon: Mic,
    title: 'Rowboat needs microphone access',
    body:
      'Voice input is off because macOS is blocking the microphone for Rowboat. ' +
      'Enable it under System Settings → Privacy & Security → Microphone, then try again.',
    section: 'microphone',
  },
  camera: {
    icon: Video,
    title: 'Rowboat needs camera access',
    body:
      'Video calls are off because macOS is blocking the camera for Rowboat. ' +
      'Enable it under System Settings → Privacy & Security → Camera, then start the call again.',
    section: 'camera',
  },
  'screen-recording': {
    icon: MonitorUp,
    title: 'Rowboat can’t see your screen',
    body:
      'macOS is blocking Screen Recording, so the assistant would only see black frames. ' +
      'Enable Rowboat under System Settings → Privacy & Security → Screen Recording, then ' +
      'relaunch Rowboat. If Rowboat is already enabled there, toggle it off and on — an ' +
      'updated app needs a fresh grant — and relaunch.',
    section: 'screen-recording',
  },
  'input-monitoring': {
    icon: Keyboard,
    title: 'Enable push-to-talk from any app',
    body:
      'Hold Right ⌘ to talk during a call — even while you’re in another app. ' +
      'For Rowboat to see that key outside its own window, macOS requires the ' +
      'Input Monitoring permission. Without it, push-to-talk still works while ' +
      'Rowboat is focused.',
    section: 'input-monitoring',
  },
}

/**
 * The one dialog behind every "a call feature silently did nothing" case:
 * explains which macOS permission is missing, deep-links to the exact
 * System Settings pane, and (for input monitoring) re-arms the global key
 * hook after the user grants it.
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
              <Button
                className="w-full"
                onClick={() => {
                  void window.ipc.invoke('app:openPrivacySettings', { section: copy.section }).catch(() => {})
                }}
              >
                Open System Settings
              </Button>
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
