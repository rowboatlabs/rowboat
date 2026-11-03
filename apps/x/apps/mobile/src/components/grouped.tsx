import { Image } from '@/components/sf-image';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// The iOS Settings shape (a labelled card of hairline-separated rows), shared
// by the invite and space screens (2026-11-02). Same look as Settings/Account.

export function Group({ label, footer, children }: { label?: string; footer?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ ...type.section, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{label}</Text> : null}
      <View style={{ borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>{children}</View>
      {footer ? <Text style={{ ...type.caption, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{footer}</Text> : null}
    </View>
  );
}

/** 46pt row; the hairline starts past the leading glyph or avatar. */
export function Row({ first, onPress, disabled, children }: { first?: boolean; onPress?: () => void; disabled?: boolean; children: ReactNode }) {
  const colors = useColors();
  return (
    <Pressable
      disabled={!onPress || disabled}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => ({ backgroundColor: pressed && onPress ? colors.secondaryBackground : 'transparent', opacity: disabled ? 0.5 : 1 })}
    >
      {first ? null : <View style={{ height: 0.5, marginLeft: 54, backgroundColor: colors.separator }} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14 }}>{children}</View>
    </Pressable>
  );
}

/** A bare symbol in the leading column — the width of a row avatar. */
export function Glyph({ icon, tint }: { icon: string; tint?: string }) {
  const colors = useColors();
  return (
    <View style={{ width: 28, alignItems: 'center' }}>
      <Image source={icon} style={{ width: 17, height: 17 }} tintColor={tint ?? colors.secondaryLabel} />
    </View>
  );
}

export function Chevron() {
  const colors = useColors();
  return <Image source="sf:chevron.right" style={{ width: 7, height: 12 }} tintColor={colors.tertiaryLabel} />;
}

/** The trailing tick of a multi-pick row: filled when picked, an empty ring when not. */
export function Tick({ on }: { on: boolean }) {
  const colors = useColors();
  return (
    <Image
      source={on ? 'sf:checkmark.circle.fill' : 'sf:circle'}
      style={{ width: 22, height: 22 }}
      tintColor={on ? colors.accent : colors.tertiaryLabel}
    />
  );
}

/** The one filled button at the foot of a form. */
export function PrimaryButton({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => ({
        paddingVertical: 14, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center',
        backgroundColor: colors.label, opacity: disabled || busy || pressed ? 0.6 : 1,
      })}
    >
      <Text style={{ ...type.bodyStrong, color: colors.background }}>{busy ? `${label}…` : label}</Text>
    </Pressable>
  );
}
