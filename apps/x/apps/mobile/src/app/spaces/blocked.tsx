import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { useSpacesAccount } from '@/lib/spaces/account';
import { unblock, useBlocked } from '@/lib/spaces/moderation';
import { useColors } from '@/theme/colors';

// People you blocked (App Store Guideline 1.2, 2026-10-20), grouped by org.
// Unblocking shows their messages and DM on this phone again.
export default function BlockedScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const blocked = useBlocked();
  const orgs = Object.entries(blocked).filter(([, list]) => list.length > 0);
  const orgName = (address: string) => account.orgs?.find((o) => o.address === address)?.name ?? address;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.secondaryBackground }}
      contentContainerStyle={{ padding: 16, gap: 24 }}
    >
      {orgs.length === 0 ? (
        <Text style={{ fontSize: 15, lineHeight: 21, color: colors.secondaryLabel, textAlign: 'center', paddingTop: 32, paddingHorizontal: 16 }}>
          You haven't blocked anyone. To block someone, press and hold one of their messages.
        </Text>
      ) : (
        orgs.map(([address, list]) => (
          <View key={address} style={{ gap: 6 }}>
            <Text style={{ fontSize: 13, color: colors.secondaryLabel, paddingHorizontal: 16, textTransform: 'uppercase' }}>{orgName(address)}</Text>
            <View style={{ borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>
              {list.map((m, i) => (
                <View
                  key={m.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 16, borderTopWidth: i === 0 ? 0 : 0.5, borderTopColor: colors.separator }}
                >
                  <Avatar id={m.id} name={m.name} size={28} />
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.label }}>{m.name}</Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                      unblock(address, m.id);
                    }}
                  >
                    <Text style={{ fontSize: 16, color: colors.accent }}>Unblock</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
