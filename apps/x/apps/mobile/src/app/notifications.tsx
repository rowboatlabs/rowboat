import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';

import { useConnection } from '@/lib/connection';
import { useSpacesAccount } from '@/lib/spaces/account';
import { PUSH_LEVELS, getPushLevel, registerWithHarbor, registerWithMac, setPushLevel, type PushLevel } from '@/lib/push';
import { useColors } from '@/theme/colors';

// Notification preferences: one global level, enforced by the Mac's watcher.
export default function NotificationsScreen() {
  const colors = useColors();
  const { rpc } = useConnection();
  const account = useSpacesAccount();
  const [level, setLevel] = useState<PushLevel | null>(null);
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    void getPushLevel().then(setLevel);
  }, []);

  const pick = async (next: PushLevel) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setLevel(next);
    await setPushLevel(next);
    // Harbor (the org servers) is the sender; a paired Mac is the fallback relay.
    const result = account.orgs?.length
      ? await registerWithHarbor(account.orgs, account.getAccessToken).catch(() => 'error' as const)
      : 'no-orgs' as const;
    if (rpc) void registerWithMac(rpc).catch(() => {});
    setState(
      result === 'registered' ? null
      : result === 'no-permission' ? 'Notifications are off in iOS Settings — enable them for Rowboat to get pushes.'
      : result === 'unavailable' ? 'Simulators can’t receive pushes — try on a real device.'
      : result === 'no-orgs' ? 'Sign in to Spaces first — notifications come from your orgs.'
      : 'Could not save this right now — it will retry on the next launch.',
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 16, paddingBottom: 12 }}>
        Push notifications for messages, DMs, and mentions across your spaces.
      </Text>
      {PUSH_LEVELS.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => void pick(option.key)}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52,
            marginHorizontal: 8, paddingHorizontal: 8, borderRadius: 10, borderCurve: 'continuous',
            backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
          })}
        >
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontSize: 16, color: colors.label }}>{option.label}</Text>
            <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>{option.detail}</Text>
          </View>
          {level === option.key ? (
            <Image source="sf:checkmark" style={{ width: 17, height: 17 }} tintColor="#0a84ff" />
          ) : null}
        </Pressable>
      ))}
      {state ? (
        <Text style={{ fontSize: 13, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 16, paddingTop: 12 }}>
          {state}
        </Text>
      ) : null}
    </ScrollView>
  );
}
