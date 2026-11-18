import { Stack, router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import { CommonActions } from 'expo-router/react-navigation';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, ScrollView, Text, TextInput } from 'react-native';
import type { Member, MemberRole, Space } from '@rowboat/spaces-protocol';

import { Avatar } from '@/components/avatar';
import { Chevron, Glyph, Group, Row } from '@/components/grouped';
import { StatusBanner } from '@/components/status-banner';
import { peekRoster, peekValue, saveRoster, saveValue } from '@/lib/spaces/cache';
import { friendlyError, isNetworkError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrgClient } from '@/lib/spaces/invites';
import { isDeparted, memberLabel } from '@/lib/spaces/profiles';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

/** A roster row; the cached roster may predate roles, so the role is optional until the server answers. */
type RosterMember = Member & { role?: MemberRole };

// A space's people (2026-11-02, desktop's members popover): who's here, and
// on top, Invite (the space's link, for anyone) and Add people (your
// contacts, people or your own agents). A DM's membership is fixed and an
// archived space takes no one new, so neither shows there. Anyone in a
// space invites to it (2026-11-09).
//
// Managing the space (2026-11-13, desktop member-admin.tsx and
// space-settings.tsx, #1376), with the server's rules (harbor spec §4 Roles):
// anyone in it renames it (not while archived) or leaves it; an admin of it
// makes a person an admin or a member again, removes anyone else, archives,
// unarchives and deletes it. An agent is never an admin, and the only admin
// can't step down. Every destructive act asks first; delete asks for the
// name on iOS, as the desktop does.
export default function MembersScreen() {
  const colors = useColors();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ org: string; space: string; title: string; me: string }>();
  const client = useOrgClient(params.org);
  const mayInvite = true;

  const [members, setMembers] = useState<RosterMember[] | null>(() => peekRoster(params.org, params.space) ?? null);
  // Roles come only from the server's answer: no admin act runs on a cached role.
  const [fresh, setFresh] = useState(false);
  const [space, setSpace] = useState<Space | undefined>(() =>
    peekValue<Space[]>(`spaces:${params.org}`)?.find((s) => s.id === params.space),
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadMembers = useCallback(
    () =>
      client.listMembers(params.space).then((list) => {
        setMembers(list);
        setFresh(true);
        saveRoster(params.org, params.space, list);
      }),
    [client, params.org, params.space],
  );

  // Reloads on focus: coming back from Add people, the new faces are here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      client
        .listMembers(params.space)
        .then((list) => {
          if (cancelled) return;
          setMembers(list);
          setFresh(true);
          saveRoster(params.org, params.space, list);
          setError(null);
        })
        .catch((err) => !cancelled && !isNetworkError(err) && setError(friendlyError(err)));
      client
        .listSpaces({ includeDirect: true })
        .then((list) => !cancelled && setSpace(list.find((s) => s.id === params.space)))
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [client, params.org, params.space]),
  );

  const sorted = useMemo(
    () => [...(members ?? [])].sort((a, b) =>
      a.id === params.me ? -1 : b.id === params.me ? 1 : a.displayName.localeCompare(b.displayName),
    ),
    [members, params.me],
  );
  const shared = space !== undefined && space.kind !== 'direct';
  const open = shared && !space.archived;
  const name = space?.name ?? params.title;
  const isAdmin = shared && fresh && members?.find((m) => m.id === params.me)?.role === 'admin';
  const adminCount = (members ?? []).filter((m) => m.role === 'admin').length;

  // The space as it now stands, everywhere this phone shows it: this screen,
  // Home's saved list (Home reloads on focus), and the chat underneath, whose
  // title rides in its params.
  const applySpace = (next: Space) => {
    setSpace(next);
    const saved = peekValue<Space[]>(`spaces:${params.org}`);
    if (saved) saveValue(`spaces:${params.org}`, saved.map((s) => (s.id === next.id ? next : s)));
    markSpacesChanged(params.org);
    for (const route of navigation.getState()?.routes ?? []) {
      const p = route.params as { space?: string } | undefined;
      if (route.name === 'chat' && p?.space === next.id) {
        navigation.dispatch({ ...CommonActions.setParams({ title: next.name }), source: route.key });
      }
    }
  };

  // Gone from the space (left or deleted): Home drops it and the stack unwinds to it.
  const goneFromSpace = () => {
    const saved = peekValue<Space[]>(`spaces:${params.org}`);
    if (saved) saveValue(`spaces:${params.org}`, saved.filter((s) => s.id !== params.space));
    markSpacesChanged(params.org);
    if (router.canDismiss()) router.dismissAll();
  };

  const run = async (act: () => Promise<unknown>, failed: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await act();
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert(failed, friendlyError(err, "You're offline. Try again when you're back online."));
    } finally {
      setBusy(false);
    }
  };

  const rename = () => {
    const next = draft?.trim();
    setDraft(null);
    if (!next || !space || next === space.name) return;
    void run(async () => applySpace(await client.renameSpace(params.space, next)), "Couldn't rename the space");
  };

  // --- an admin's acts on one member (desktop member-admin.tsx) -------------

  const setRole = (m: RosterMember, role: MemberRole) =>
    void run(async () => {
      await client.setSpaceRole(params.space, m.id, role);
      await reloadMembers();
    }, "Couldn't change their role");

  const confirmRemove = (m: RosterMember) => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      `Remove ${m.displayName} from #${name}?`,
      m.kind === 'agent'
        ? 'It stops seeing this space and answering here. What it wrote stays.'
        : 'They stop seeing this space, and their agents leave with them. What they wrote stays; someone in the space can invite them back.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await client.removeMember(params.space, m.id);
              await reloadMembers();
            }, "Couldn't remove them"),
        },
      ],
    );
  };

  /** What an admin may do to this member; empty for a non-admin, a departed member, or the only admin themself. */
  const actsOn = (m: RosterMember): { label: string; destructive?: boolean; run: () => void }[] => {
    if (!isAdmin || !m.role || isDeparted(m)) return [];
    const self = m.id === params.me;
    const acts: { label: string; destructive?: boolean; run: () => void }[] = [];
    if (m.kind !== 'agent') {
      if (m.role === 'admin') {
        if (!self || adminCount > 1) acts.push({ label: self ? 'Step down as admin' : 'Remove admin', run: () => setRole(m, 'member') });
      } else {
        acts.push({ label: 'Make admin', run: () => setRole(m, 'admin') });
      }
    }
    if (!self) acts.push({ label: `Remove from #${name}`, destructive: true, run: () => confirmRemove(m) });
    return acts;
  };

  const memberMenu = (m: RosterMember, acts: ReturnType<typeof actsOn>) => {
    const title = m.displayName;
    if (process.env.EXPO_OS === 'ios') {
      const options = [...acts.map((a) => a.label), 'Cancel'];
      const destructive = acts.findIndex((a) => a.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options, cancelButtonIndex: acts.length, destructiveButtonIndex: destructive >= 0 ? destructive : undefined },
        (i) => acts[i]?.run(),
      );
      return;
    }
    // Android has no action sheet; an alert holds the (at most two) acts and Cancel.
    Alert.alert(title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      ...acts.map((a) => ({ text: a.label, style: a.destructive ? ('destructive' as const) : ('default' as const), onPress: a.run })),
    ]);
  };

  // --- the space itself (desktop space-admin-dialogs.tsx) -------------------

  const confirmLeave = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      `Leave #${name}?`,
      "You'll stop seeing it, and your agents leave with you. What you wrote stays; someone in the space can invite you back.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () =>
            void run(async () => {
              await client.leaveSpace(params.space);
              goneFromSpace();
            }, "Couldn't leave the space"),
        },
      ],
    );
  };

  const confirmArchive = () =>
    Alert.alert(`Archive #${name}?`, 'Members can still read it, but nobody can post, upload or change anything until an admin unarchives it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', onPress: () => void run(async () => applySpace(await client.archiveSpace(params.space)), "Couldn't archive the space") },
    ]);

  const unarchive = () => void run(async () => applySpace(await client.unarchiveSpace(params.space)), "Couldn't unarchive the space");

  const runDelete = () =>
    void run(async () => {
      await client.deleteSpace(params.space);
      goneFromSpace();
    }, "Couldn't delete the space");

  // Delete can't be undone and the server doesn't confirm on its own, so the
  // desktop asks for the space's name; Alert.prompt is iOS-only, so Android
  // ends on the plain warning (as account deletion does, 2026-10-16).
  const confirmDelete = () => {
    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const warning = 'Every message, file and membership in this space is deleted for everyone. This cannot be undone.';
    if (process.env.EXPO_OS !== 'ios') {
      Alert.alert(`Delete #${name}?`, warning, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete space', style: 'destructive', onPress: runDelete },
      ]);
      return;
    }
    Alert.prompt(`Delete #${name}?`, `${warning} Type the space name to confirm.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete space',
        style: 'destructive',
        onPress: (value?: string) => {
          if (value?.trim() === name) runDelete();
          else Alert.alert('Not deleted', `You need to type ${name} to confirm.`);
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'Members', headerRight: () => (busy ? <ActivityIndicator /> : null) }} />
      <StatusBanner error={error} />
      {open ? (
        <Group>
          {mayInvite ? (
            <Row first onPress={() => router.push({ pathname: '/spaces/invite', params: { org: params.org, space: params.space } })}>
              <Glyph icon="sf:person.badge.plus" />
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>Invite to #{name}</Text>
              <Chevron />
            </Row>
          ) : null}
          <Row
            first={!mayInvite}
            onPress={() => router.push({ pathname: '/spaces/add-people', params: { org: params.org, space: params.space, title: name, me: params.me } })}
          >
            <Glyph icon="sf:person.2" />
            <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>Add people and your agents</Text>
            <Chevron />
          </Row>
        </Group>
      ) : null}

      {shared ? (
        <Group label="Name" footer={space.archived ? 'An archived space keeps its name until an admin unarchives it.' : undefined}>
          <Row first>
            <Glyph icon="sf:number" />
            <TextInput
              value={draft ?? name}
              onChangeText={setDraft}
              onEndEditing={rename}
              editable={open && !busy}
              maxLength={100}
              returnKeyType="done"
              autoCorrect={false}
              placeholder="Space name"
              placeholderTextColor={colors.tertiaryLabel}
              style={{ flex: 1, paddingVertical: 12, ...type.body, color: open ? colors.label : colors.secondaryLabel }}
            />
          </Row>
        </Group>
      ) : null}

      {members === null && !error ? <ActivityIndicator /> : null}
      {sorted.length > 0 ? (
        <Group
          label={`${sorted.length} ${sorted.length === 1 ? 'member' : 'members'}`}
          footer={isAdmin ? 'Tap someone to make them an admin or remove them. A space keeps at least one admin.' : undefined}
        >
          {sorted.map((m, i) => {
            const acts = actsOn(m);
            return (
              <Row key={m.id} first={i === 0} disabled={busy} onPress={acts.length > 0 ? () => memberMenu(m, acts) : undefined}>
                <Avatar id={m.id} name={m.displayName} size={28} url={m.avatarUrl} />
                <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>
                  {memberLabel(m)}
                  {m.id === params.me ? <Text style={{ color: colors.tertiaryLabel }}> (you)</Text> : null}
                </Text>
                {m.kind === 'agent' ? (
                  <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Agent</Text>
                ) : m.role === 'admin' ? (
                  <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Admin</Text>
                ) : null}
                {acts.length > 0 ? <Glyph icon="sf:ellipsis" tint={colors.tertiaryLabel} /> : null}
              </Row>
            );
          })}
        </Group>
      ) : null}

      {shared && fresh ? (
        <Group footer={isAdmin ? undefined : 'Only an admin of this space can archive or delete it.'}>
          {isAdmin ? (
            <Row first disabled={busy} onPress={space.archived ? unarchive : confirmArchive}>
              <Glyph icon={space.archived ? 'sf:tray.and.arrow.up' : 'sf:archivebox'} />
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>{space.archived ? 'Unarchive space' : 'Archive space'}</Text>
            </Row>
          ) : null}
          <Row first={!isAdmin} disabled={busy} onPress={confirmLeave}>
            <Glyph icon="sf:rectangle.portrait.and.arrow.right" tint={colors.destructive} />
            <Text style={{ flex: 1, ...type.body, color: colors.destructive }}>Leave #{name}</Text>
          </Row>
          {isAdmin ? (
            <Row disabled={busy} onPress={confirmDelete}>
              <Glyph icon="sf:trash" tint={colors.destructive} />
              <Text style={{ flex: 1, ...type.body, color: colors.destructive }}>Delete space</Text>
            </Row>
          ) : null}
        </Group>
      ) : null}
    </ScrollView>
  );
}
