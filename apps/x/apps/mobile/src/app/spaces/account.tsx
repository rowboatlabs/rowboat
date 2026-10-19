import { router } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { useSpacesAccount, type SpacesOrg } from '@/lib/spaces/account';
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
  const myAvatar = useMyAvatar(me);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const clientFor = (org: SpacesOrg) => new SpacesClient({ baseUrl: `https://${org.address}`, token: (opts) => account.getAccessToken(opts) });

  // Name and title as saved, and as being typed. The title isn't on the org
  // listing, so both come from GET /v1/me.
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile>({ displayName: '', title: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    clientFor(me)
      .me()
      .then(({ member }) => {
        if (cancelled) return;
        const saved = { displayName: member.displayName, title: member.title ?? '' };
        setProfile(saved);
        setDraft(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per org, not per render's client
  }, [me?.id, me?.address]);
  const name = profile?.displayName || me?.displayName || 'Your account';

  // Like the photo, your name and title are set on every org you're in.
  const saveProfile = async (field: keyof Profile) => {
    if (!profile) return;
    const value = draft[field].replace(/\s+/g, ' ').trim();
    if (value === profile[field] || (field === 'displayName' && !value)) {
      setDraft((d) => ({ ...d, [field]: profile[field] }));
      return;
    }
    setSavingProfile(true);
    try {
      for (const org of account.orgs ?? []) await clientFor(org).updateProfile({ [field]: value });
      const saved = { ...profile, [field]: value };
      setProfile(saved);
      setDraft(saved);
      if (field === 'displayName') void account.refreshOrgs();
    } catch (err) {
      setDraft((d) => ({ ...d, [field]: profile[field] }));
      Alert.alert("Couldn't update your profile", friendlyError(err));
    } finally {
      setSavingProfile(false);
    }
  };

  // Your photo is per org on the server; set it on every org you're in so
  // you look the same everywhere.
  const eachOrg = async (work: (client: SpacesClient) => Promise<{ avatarUrl?: string }>) => {
    setSavingPhoto(true);
    try {
      for (const org of account.orgs ?? []) {
        setMyAvatar(org.id, (await work(clientFor(org))).avatarUrl);
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

  const runDelete = () => {
    setDeleting(true);
    account
      .deleteAccount()
      .then(({ deleteBy }) => {
        router.replace('/spaces');
        const date = new Date(deleteBy).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        Alert.alert('Account deletion requested', `Your account and its data will be permanently deleted by ${date}. We've emailed you a confirmation.`);
      })
      .catch((err) => Alert.alert("Couldn't delete account", err instanceof Error ? err.message : String(err)))
      .finally(() => setDeleting(false));
  };

  // Three confirmations (2026-10-16): what happens, a last chance, then typing
  // DELETE — deletion can't be undone from the app. Alert.prompt is iOS-only,
  // so Android ends on a plain button.
  const typeToConfirm = () => {
    if (process.env.EXPO_OS !== 'ios') {
      Alert.alert('Final step', 'Delete your account now?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: runDelete },
      ]);
      return;
    }
    Alert.prompt('Final step', 'Type DELETE to confirm.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete account',
        style: 'destructive',
        onPress: (value?: string) => {
          if (value?.trim().toUpperCase() === 'DELETE') runDelete();
          else Alert.alert('Not deleted', 'You need to type DELETE to confirm.');
        },
      },
    ]);
  };
  const confirmDelete = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Delete your account?',
      "You'll be signed out and removed from all your orgs right away. Your account and its data are permanently deleted within 30 days.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert(
              'Are you sure?',
              "You'll leave every org, your agents will stop working, and you won't be able to sign in again. Your messages stay, marked as deactivated. This can't be undone.",
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Continue', style: 'destructive', onPress: typeToConfirm },
              ],
            );
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
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {/* Identity */}
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <Pressable disabled={savingPhoto} onPress={photoMenu} style={({ pressed }) => ({ opacity: pressed || savingPhoto ? 0.6 : 1 })}>
          <Avatar id={me?.memberId ?? ''} name={name} size={84} url={myAvatar} />
        </Pressable>
        <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.label }}>{name}</Text>
          {profile?.title ? <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>{profile.title}</Text> : null}
        </View>
        <Pressable disabled={savingPhoto} onPress={photoMenu} hitSlop={8}>
          <Text style={{ fontSize: 15, color: '#0a84ff' }}>{savingPhoto ? 'Saving…' : myAvatar ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
      </View>

      {profile ? (
        <Group label="Profile" footer="How your teammates see you in every org you're in.">
          <Row first>
            <Text style={{ width: 56, fontSize: 16, color: colors.label }}>Name</Text>
            <TextInput
              value={draft.displayName}
              onChangeText={(displayName) => setDraft((d) => ({ ...d, displayName }))}
              onEndEditing={() => void saveProfile('displayName')}
              editable={!savingProfile}
              placeholder="Your name"
              placeholderTextColor={colors.tertiaryLabel}
              maxLength={128}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="name"
              returnKeyType="done"
              style={{ flex: 1, fontSize: 16, color: colors.label, paddingVertical: 12 }}
            />
          </Row>
          <Row>
            <Text style={{ width: 56, fontSize: 16, color: colors.label }}>Title</Text>
            <TextInput
              value={draft.title}
              onChangeText={(title) => setDraft((d) => ({ ...d, title }))}
              onEndEditing={() => void saveProfile('title')}
              editable={!savingProfile}
              placeholder="What you do"
              placeholderTextColor={colors.tertiaryLabel}
              maxLength={128}
              textContentType="jobTitle"
              returnKeyType="done"
              style={{ flex: 1, fontSize: 16, color: colors.label, paddingVertical: 12 }}
            />
            {savingProfile ? <ActivityIndicator size="small" /> : null}
          </Row>
        </Group>
      ) : null}

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

      <Group footer="Signs you out, removes you from every org, and permanently deletes your Rowboat account within 30 days.">
        <Row first onPress={deleting ? undefined : confirmDelete}>
          <Text style={{ flex: 1, fontSize: 16, color: colors.destructive }}>Delete account</Text>
          {deleting ? <ActivityIndicator size="small" /> : null}
        </Row>
      </Group>
    </ScrollView>
  );
}

interface Profile {
  displayName: string;
  title: string;
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
