import { create } from 'qrcode';
import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// A QR code for a link, drawn as one SVG path (2026-11-10, invite screen):
// someone in the room scans it with their phone's camera instead of being
// sent the link. Always dark on white with a four-module quiet zone, in dark
// mode too — inverted codes scan unreliably.
export function QrCode({ value, size }: { value: string; size: number }) {
  const { d, count } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    let path = '';
    for (let r = 0; r < modules.size; r++) {
      for (let c = 0; c < modules.size; c++) {
        if (modules.get(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
      }
    }
    return { d: path, count: modules.size + 8 };
  }, [value]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="QR code of the link"
      style={{ width: size, height: size, backgroundColor: '#fff', borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
        <Path d={d} fill="#000" />
      </Svg>
    </View>
  );
}
