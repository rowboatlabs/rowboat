import { LinearGradient } from 'expo-linear-gradient';

import { useColors } from '@/theme/colors';

// A soft top edge for screens where iOS's own scroll-edge effect can't run
// (the inverted chat list flips it). Solid under the see-through header, then
// a short fade — content dissolves into the bar instead of a hard line.
export function HeaderFade({ headerHeight, fade = 28 }: { headerHeight: number; fade?: number }) {
  const colors = useColors();
  const total = headerHeight + fade;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[colors.background, colors.background, `${colors.background}00`]}
      locations={[0, headerHeight / total, 1]}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: total, zIndex: 1 }}
    />
  );
}
