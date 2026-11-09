import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import type { Member, Space } from '@rowboat/spaces-protocol';

import { Avatar } from '@/components/avatar';
import { Chevron, Glyph, Group, Row } from '@/components/grouped';
import { StatusBanner } from '@/components/status-banner';
import { peekRoster, peekValue, saveRoster } from '@/lib/spaces/cache';
import { friendlyError, isNetworkError } from '@/lib/spaces/errors';
import { useOrgClient } from '@/lib/spaces/invites';
import { memberLabel } from '@/lib/spaces/profiles';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// A space's people (2026-11-02, desktop's members popover): who's here, and
// on top, Invite (the group's link, for anyone) and Add people (your
// contacts, people or your own agents). A DM's membership is fixed and an
// archived space takes no one new, so neither shows there. Anyone in a
// group invites to it (2026-11-09).
export default function MembersScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; title: string; me: string }>();
  const client = useOrgClient(params.org);
  const mayInvite = true;

  const [members, setMembers] = useState<Member[] | null>(() => peekRoster(params.org, params.space) ?? null);
  const [space, setSpace] = useState<Space | undefined>(() =>
    peekValue<Space[]>(`spaces:${params.org}`)?.find((s) => s.id === params.space),
  );
  const [error, setError] = useState<string | null>(null);

  // Reloads on focus: coming back from Add people, the new faces are here.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      client
        .listMembers(params.space)
        .then((list) => {
          if (cancelled) return;
          setMembers(list);
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
  const open = space !== undefined && space.kind !== 'direct' && !space.archived;
  const name = space?.name ?? params.title;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'Members' }} />
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

      {members === null && !error ? <ActivityIndicator /> : null}
      {sorted.length > 0 ? (
        <Group label={`${sorted.length} ${sorted.length === 1 ? 'member' : 'members'}`}>
          {sorted.map((m, i) => (
            <Row key={m.id} first={i === 0}>
              <Avatar id={m.id} name={m.displayName} size={28} url={m.avatarUrl} />
              <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>
                {memberLabel(m)}
                {m.id === params.me ? <Text style={{ color: colors.tertiaryLabel }}> (you)</Text> : null}
              </Text>
              {m.kind === 'agent' ? <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Agent</Text> : null}
            </Row>
          ))}
        </Group>
      ) : null}
    </ScrollView>
  );
}
