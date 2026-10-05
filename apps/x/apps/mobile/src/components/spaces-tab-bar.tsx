import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/theme/colors';

// EXPERIMENT (2026-10-05): Slack's floating bottom bar for the Spaces section —
// a glass pill of destinations and a separate round search button. Liquid
// glass on iOS 26, a blur elsewhere.

export type SpacesTab = 'home' | 'dms' | 'activity' | 'more' | 'search';

const TABS: { key: Exclude<SpacesTab, 'search'>; label: string; icon: string; iconOn: string }[] = [
  { key: 'home', label: 'Home', icon: 'sf:house', iconOn: 'sf:house.fill' },
  { key: 'dms', label: 'DMs', icon: 'sf:bubble.left.and.bubble.right', iconOn: 'sf:bubble.left.and.bubble.right.fill' },
  { key: 'activity', label: 'Activity', icon: 'sf:bell', iconOn: 'sf:bell.fill' },
  { key: 'more', label: 'More', icon: 'sf:ellipsis', iconOn: 'sf:ellipsis' },
];

export const SPACES_TAB_BAR_HEIGHT = 64;

function Glass({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const colors = useColors();
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      intensity={50}
      tint={colors.isDark ? 'dark' : 'light'}
      style={[{ overflow: 'hidden', borderWidth: 0.5, borderColor: colors.separator, backgroundColor: colors.isDark ? 'rgba(40,38,35,0.7)' : 'rgba(250,249,246,0.7)' }, style]}
    >
      {children}
    </BlurView>
  );
}

export function SpacesTabBar({ tab, onChange }: { tab: SpacesTab; onChange: (tab: SpacesTab) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const pick = (next: SpacesTab) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    onChange(next);
  };
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12), flexDirection: 'row', alignItems: 'center', gap: 10 }}
    >
      <Glass style={{ flex: 1, height: SPACES_TAB_BAR_HEIGHT, borderRadius: SPACES_TAB_BAR_HEIGHT / 2, flexDirection: 'row', alignItems: 'center', padding: 5 }}>
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => pick(t.key)}
              style={{
                flex: 1, height: '100%', borderRadius: 27, alignItems: 'center', justifyContent: 'center', gap: 3,
                backgroundColor: on ? (colors.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)') : 'transparent',
              }}
            >
              <Image source={on ? t.iconOn : t.icon} style={{ width: 22, height: 20 }} contentFit="contain" tintColor={on ? colors.label : colors.secondaryLabel} />
              <Text style={{ fontSize: 11, fontWeight: on ? '700' : '500', color: on ? colors.label : colors.secondaryLabel }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </Glass>
      <Pressable onPress={() => pick('search')}>
        <Glass style={{ width: SPACES_TAB_BAR_HEIGHT, height: SPACES_TAB_BAR_HEIGHT, borderRadius: SPACES_TAB_BAR_HEIGHT / 2, alignItems: 'center', justifyContent: 'center' }}>
          <Image source="sf:magnifyingglass" style={{ width: 22, height: 22 }} tintColor={tab === 'search' ? colors.label : colors.secondaryLabel} />
        </Glass>
      </Pressable>
    </View>
  );
}
