import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ScrollView, Pressable, Text, View } from 'react-native';

import { useConnection } from '@/lib/connection';
import { PUSH_LEVELS, getPushLevel, registerWithMac, setPushLevel, type PushLevel } from '@/lib/push';
import { useColors } from '@/theme/colors';

// Notification preferences: one global level, enforced by the Mac's watcher.
export default function NotificationsScreen() {
  const colors = useColors();
  const { rpc, pairing } = useConnection();
  const [level, setLevel] = useState<PushLevel | null>(null);
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    void getPushLevel().then(setLevel);
  }, []);

  const pick = async (next: PushLevel) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setLevel(next);
    await setPushLevel(next);
    if (rpc) {
      const result = await registerWithMac(rpc).catch(() => 'error' as const);
      setState(
        result === 'registered' ? null
        : result === 'no-permission' ? 'Notifications are off in iOS Settings — enable them for Rowboat to get pushes.'
        : result === 'unavailable' ? 'Simulators can’t receive pushes — try on a real device.'
        : 'Could not reach your Mac to save this — it will retry on the next connect.',
      );
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingVertical: 12 }}
    >
      <Text style={{ fontSize: 13, lineHeight: 18, color: colors.secondaryLabel, paddingHorizontal: 16, paddingBottom: 12 }}>
        Push notifications for your spaces{pairing ? '' : ' — connect your Mac to turn these on'}. Your Mac relays them,
        so it needs to be running.
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
