import { Activity, type ReactNode } from 'react'
import { SectionVisibleContext, useSectionVisible } from '@/lib/section-visibility'

/**
 * A middle-pane section that stays mounted once visited: hidden ones keep their
 * state and DOM (instant switches, scroll preserved) while React pauses their
 * effects.
 *
 * The visibility it publishes is what keeps overlays honest — see
 * lib/section-visibility for what goes wrong without it.
 */
export function KeepAliveSection({ visible, children }: { visible: boolean; children: ReactNode }) {
  // A section nested in a hidden one is hidden too, whatever it thinks.
  const parentVisible = useSectionVisible()
  const onScreen = visible && parentVisible
  return (
    <Activity mode={visible ? 'visible' : 'hidden'}>
      <SectionVisibleContext.Provider value={onScreen}>{children}</SectionVisibleContext.Provider>
    </Activity>
  )
}
