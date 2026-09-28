import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { useColors } from '@/theme/colors';

// Account (iOS Settings shape): who you are, your orgs, notifications, sign
// out — and, last and quiet, Delete account (App Store 5.1.1(v)).
export default function AccountScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const [deleting, setDeleting] = useState(false);
  const name = account.orgs?.[0]?.displayName ?? 'Your account';

  const confirmDelete = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your Rowboat account and removes you from all your orgs. Any subscription is cancelled. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            account
              .deleteAccount()
              .then(() => {
                router.replace('/spaces');
                Alert.alert('Account deleted', 'Your Rowboat account has been deleted.');
              })
              .catch((err) => Alert.alert("Couldn't delete account", err instanceof Error ? err.message : String(err)))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.secondaryBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}
    >
      {/* Identity */}
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3b6fb6' }}>
          <Text style={{ fontSize: 30, fontWeight: '600', color: '#ffffff' }}>{(name[0] ?? '?').toUpperCase()}</Text>
        </View>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.label }}>{name}</Text>
      </View>

      {account.orgs?.length ? (
        <Group label="Orgs">
          {account.orgs.map((org, i) => (
            <Row key={org.id} first={i === 0}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.label }}>{org.name}</Text>
              <Text style={{ fontSize: 15, color: colors.tertiaryLabel }}>{org.role === 'admin' ? 'Admin' : 'Member'}</Text>
            </Row>
          ))}
        </Group>
      ) : null}

      <Group>
        <Row first onPress={() => router.push('/notifications')}>
          <Image source="sf:bell" style={{ width: 18, height: 18 }} tintColor={colors.secondaryLabel} />
          <Text style={{ flex: 1, fontSize: 16, color: colors.label }}>Notifications</Text>
          <Image source="sf:chevron.right" style={{ width: 8, height: 13 }} tintColor={colors.tertiaryLabel} />
        </Row>
        <Row onPress={() => void account.signOut().then(() => router.replace('/spaces'))}>
          <Image source="sf:rectangle.portrait.and.arrow.right" style={{ width: 18, height: 18 }} tintColor={colors.destructive} />
          <Text style={{ flex: 1, fontSize: 16, color: colors.destructive }}>Sign out</Text>
        </Row>
      </Group>

      <Group footer="Permanently deletes your Rowboat account and removes you from every org.">
        <Row first onPress={deleting ? undefined : confirmDelete}>
          <Text style={{ flex: 1, fontSize: 16, color: colors.destructive }}>Delete account</Text>
          {deleting ? <ActivityIndicator size="small" /> : null}
        </Row>
      </Group>
    </ScrollView>
  );
}

function Group({ label, footer, children }: { label?: string; footer?: string; children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={{ fontSize: 13, color: colors.secondaryLabel, paddingHorizontal: 16, textTransform: 'uppercase' }}>{label}</Text> : null}
      <View style={{ borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.background }}>{children}</View>
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
