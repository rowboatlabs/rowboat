import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { useColors } from '@/theme/colors';

// The Rowboat mark, filled (2026-11-13): the desktop's RowboatMark artwork
// (renderer quick-ask-bar.tsx), drawn at Glyph's size and column so it sits in
// a grouped row in place of an SF Symbol where the row means "Rowboat does it".
export function RowboatMark({ size = 17, tint }: { size?: number; tint?: string }) {
  const colors = useColors();
  return (
    <View style={{ width: 28, alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={tint ?? colors.secondaryLabel}>
        <G transform="translate(12 12) scale(0.0245) translate(-497 -489)">
          <Path d="M 158 487 C 330 330, 620 180, 837 148 C 820 480, 640 720, 498 830 Q 550 720, 569 623 C 560 540, 450 440, 352 413 Q 250 440, 158 487 Z" />
        </G>
      </Svg>
    </View>
  );
}
