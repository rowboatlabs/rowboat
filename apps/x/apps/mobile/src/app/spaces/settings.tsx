import { router } from 'expo-router';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { THEME_PREFS, getThemePref, setThemePref, type ThemePref } from '@/lib/theme-preference';
import { useColors } from '@/theme/colors';

// Settings (iOS Settings shape): account, appearance, notifications, about.
export default function SettingsScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const [theme, setTheme] = useState<ThemePref | null>(null);
  const name = account.orgs?.[0]?.displayName;
  const version = Constants.expoConfig?.version ?? '';
  const build = Constants.expoConfig?.ios?.buildNumber;

  useEffect(() => {
    void getThemePref().then(setTheme);
  }, []);

  const pickTheme = (pref: ThemePref) => {
    setTheme(pref);
    void setThemePref(pref);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.secondaryBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}
    >
      {account.status === 'signedIn' ? (
        <Group radius={22}>
          <Row first onPress={() => router.push('/spaces/account')}>
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3b6fb6' }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#ffffff' }}>{((name ?? '?')[0] ?? '?').toUpperCase()}</Text>
            </View>
            <Text style={{ flex: 1, paddingVertical: 14, fontSize: 17, fontWeight: '600', color: colors.label }}>{name ?? 'Your account'}</Text>
            <Chevron />
          </Row>
        </Group>
      ) : null}

      <Group label="Appearance">
        {THEME_PREFS.map((t, i) => (
          <Row key={t.key} first={i === 0} onPress={() => pickTheme(t.key)}>
            <Image
              source={t.key === 'system' ? 'sf:circle.lefthalf.filled' : t.key === 'light' ? 'sf:sun.max' : 'sf:moon'}
              style={{ width: 18, height: 18 }}
              tintColor={colors.secondaryLabel}
            />
            <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>{t.label}</Text>
            {theme === t.key ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor="#0a84ff" /> : null}
          </Row>
        ))}
      </Group>

      <Group>
        <Row first onPress={() => router.push('/spaces/notifications')}>
          <Image source="sf:bell" style={{ width: 18, height: 18 }} tintColor={colors.secondaryLabel} />
          <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>Notifications</Text>
          <Chevron />
        </Row>
      </Group>

      <Group label="About" footer={version ? `Rowboat Spaces ${version}${build ? ` (${build})` : ''}` : undefined}>
        <Row first onPress={() => void WebBrowser.openBrowserAsync('https://www.rowboatlabs.com/privacy-policy')}>
          <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>Privacy Policy</Text>
          <Image source="sf:arrow.up.right" style={{ width: 12, height: 12 }} tintColor={colors.tertiaryLabel} />
        </Row>
        <Row onPress={() => void WebBrowser.openBrowserAsync('https://www.rowboatlabs.com/terms-of-service')}>
          <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>Terms of Service</Text>
          <Image source="sf:arrow.up.right" style={{ width: 12, height: 12 }} tintColor={colors.tertiaryLabel} />
        </Row>
      </Group>
    </ScrollView>
  );
}

function Chevron() {
  const colors = useColors();
  return <Image source="sf:chevron.right" style={{ width: 8, height: 13 }} tintColor={colors.tertiaryLabel} />;
}

function Group({ label, footer, radius = 12, children }: { label?: string; footer?: string; radius?: number; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ fontSize: 13, color: colors.secondaryLabel, paddingHorizontal: 16, textTransform: 'uppercase' }}>{label}</Text> : null}
      <View style={{ borderRadius: radius, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.background }}>{children}</View>
      {footer ? <Text style={{ fontSize: 13, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{footer}</Text> : null}
    </View>
  );
}

function Row({ first, onPress, children }: { first?: boolean; onPress?: () => void; children: ReactNode }) {
  const colors = useColors();
  return (
    <Pressable
      disabled={!onPress}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress?.();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 16,
        borderTopWidth: first ? 0 : 0.5, borderTopColor: colors.separator,
        backgroundColor: pressed && onPress ? colors.secondaryBackground : 'transparent',
      })}
    >
      {children}
    </Pressable>
  );
}
