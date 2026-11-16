import { Image as ExpoImage, type ImageProps } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { MATERIAL_FOR_SF } from '@/lib/symbols';

// expo-image's Image, plus Android icons (2026-10-28). The app draws its icons
// as `<Image source="sf:…">`, which only iOS understands. On Android an `sf:`
// source becomes the matching Material Symbol (lib/symbols.ts), drawn in the
// same box with the same tint; every other source passes straight through.
// iOS gets expo-image itself, untouched.

function AndroidImage(props: ImageProps) {
  const { source, style, tintColor } = props;
  if (typeof source !== 'string' || !source.startsWith('sf:')) return <ExpoImage {...props} />;

  const sf = source.slice(3);
  const flat = StyleSheet.flatten(style) ?? {};
  const width = typeof flat.width === 'number' ? flat.width : 24;
  const height = typeof flat.height === 'number' ? flat.height : 24;
  // Material glyphs sit inside padding; SF glyphs fill their frame. Draw a
  // little larger and let the overflow straddle the original box so layout
  // doesn't move.
  const size = Math.round(Math.max(width, height) * 1.2);
  return (
    <SymbolView
      name={{ ios: sf as SFSymbol, android: MATERIAL_FOR_SF[sf] }}
      size={size}
      tintColor={tintColor ?? undefined}
      style={[
        flat,
        {
          width: size,
          height: size,
          marginHorizontal: (width - size) / 2 + (typeof flat.marginHorizontal === 'number' ? flat.marginHorizontal : 0),
          marginVertical: (height - size) / 2 + (typeof flat.marginVertical === 'number' ? flat.marginVertical : 0),
        },
      ]}
    />
  );
}

export const Image = process.env.EXPO_OS === 'android' ? AndroidImage : ExpoImage;
