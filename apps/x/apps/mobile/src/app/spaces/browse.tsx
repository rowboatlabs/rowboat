import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text } from 'react-native';
import type { Space } from '@rowboat/spaces-protocol';

import { Chevron, Glyph, Group, Row } from '@/components/grouped';
import { StatusBanner } from '@/components/status-banner';
import { friendlyError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrg, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

type Entry = { space: Space; joined: boolean };

// Browse spaces (2026-11-02, desktop space-browser.tsx): the org's open
// spaces. Tap one you're in to open it; tap one you're not to join and open.
export default function BrowseScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);
  const org = useOrg(params.org);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .browseSpaces()
      .then((result) => {
        if (cancelled) return;
        setSupported(result.supported);
        setEntries(result.spaces.filter((e) => !e.space.archived).sort((a, b) => a.space.name.localeCompare(b.space.name)));
      })
      .catch((err) => !cancelled && setError(friendlyError(err)));
    return () => {
      cancelled = true;
    };
  }, [client]);

  const openSpace = (space: Space) =>
    router.push({ pathname: '/spaces/chat', params: { org: params.org, space: space.id, title: space.name, me: params.me } });

  const pick = async ({ space, joined }: Entry) => {
    if (joined) return openSpace(space);
    setJoining(space.id);
    try {
      await client.joinSpace(space.id);
      markSpacesChanged(params.org);
      setEntries((prev) => prev?.map((e) => (e.space.id === space.id ? { ...e, joined: true } : e)) ?? prev);
      openSpace(space);
    } catch (err) {
      Alert.alert(`Couldn't join #${space.name}`, friendlyError(err));
    } finally {
      setJoining(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'Browse spaces' }} />
      <StatusBanner error={error} />
      {entries === null && !error ? <ActivityIndicator /> : null}
      {entries !== null && (!supported || entries.length === 0) ? (
        <Text style={{ ...type.body, lineHeight: 22, textAlign: 'center', color: colors.tertiaryLabel, paddingTop: 24, paddingHorizontal: 16 }}>
          {supported ? `${org?.name ?? 'This org'} has no open spaces yet.` : `${org?.name ?? 'This org'} needs a server update to list open spaces.`}
        </Text>
      ) : null}
      {entries && entries.length > 0 ? (
        <Group footer="Open spaces anyone in the org can join.">
          {entries.map((e, i) => (
            <Row key={e.space.id} first={i === 0} disabled={joining !== null && joining !== e.space.id} onPress={() => void pick(e)}>
              <Glyph icon="sf:number" />
              <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{e.space.name}</Text>
              {joining === e.space.id ? (
                <ActivityIndicator size="small" />
              ) : e.joined ? (
                <>
                  <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Joined</Text>
                  <Chevron />
                </>
              ) : (
                <Text style={{ ...type.bodyStrong, color: colors.label }}>Join</Text>
              )}
            </Row>
          ))}
        </Group>
      ) : null}
    </ScrollView>
  );
}
