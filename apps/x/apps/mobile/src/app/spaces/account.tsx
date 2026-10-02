import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { setMyAvatar, useMyAvatar } from '@/lib/spaces/my-avatar';
import { pickProfileImage } from '@/lib/spaces/profile-image';
import { useColors } from '@/theme/colors';

// Account (iOS Settings shape): who you are, your orgs, notifications, sign
// out — and, last and quiet, Delete account (App Store 5.1.1(v)).
export default function AccountScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const [deleting, setDeleting] = useState(false);
  const me = account.orgs?.[0];
  const name = me?.displayName ?? 'Your account';
  const myAvatar = useMyAvatar(me);
  const [savingPhoto, setSavingPhoto] = useState(false);

  // Your photo is per org on the server; set it on every org you're in so
  // you look the same everywhere.
  const eachOrg = async (work: (client: SpacesClient) => Promise<{ avatarUrl?: string }>) => {
    setSavingPhoto(true);
    try {
      for (const org of account.orgs ?? []) {
        const client = new SpacesClient({ baseUrl: `https://${org.address}`, token: (opts) => account.getAccessToken(opts) });
        setMyAvatar(org.id, (await work(client)).avatarUrl);
      }
    } catch (err) {
      Alert.alert("Couldn't update your photo", friendlyError(err));
    } finally {
      setSavingPhoto(false);
    }
  };
  const choosePhoto = async () => {
    const image = await pickProfileImage().catch(() => null);
    if (image) await eachOrg((client) => client.setAvatar(image));
  };
  const photoMenu = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    const options = myAvatar ? ['Choose photo', 'Remove photo', 'Cancel'] : ['Choose photo', 'Cancel'];
    if (process.env.EXPO_OS !== 'ios') {
      void choosePhoto();
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: myAvatar ? 1 : undefined },
      (i) => {
        if (i === 0) void choosePhoto();
        else if (myAvatar && i === 1) void eachOrg((client) => client.clearAvatar());
      },
    );
  };

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
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: 48 }}
    >
      {/* Identity */}
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <Pressable disabled={savingPhoto} onPress={photoMenu} style={({ pressed }) => ({ opacity: pressed || savingPhoto ? 0.6 : 1 })}>
          <Avatar id={me?.memberId ?? ''} name={name} size={84} url={myAvatar} />
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.label }}>{name}</Text>
        <Pressable disabled={savingPhoto} onPress={photoMenu} hitSlop={8}>
          <Text style={{ fontSize: 15, color: '#0a84ff' }}>{savingPhoto ? 'Saving…' : myAvatar ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
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
        <Row first onPress={() => router.push('/spaces/notifications')}>
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
      <View style={{ borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: colors.card }}>{children}</View>
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
