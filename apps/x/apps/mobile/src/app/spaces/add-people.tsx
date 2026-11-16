import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Member } from '@rowboat/spaces-protocol';

import { Avatar } from '@/components/avatar';
import { Group, Row, Tick } from '@/components/grouped';
import { saveRoster } from '@/lib/spaces/cache';
import { friendlyError } from '@/lib/spaces/errors';
import { useOrgClient } from '@/lib/spaces/invites';
import { isDeparted } from '@/lib/spaces/profiles';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Add people (2026-11-02, desktop add-members-dialog.tsx): any member adds
// their contacts, people or their own agents, to a space they're in
// (2026-11-09). Never offered: who's already here, a deleted account, or an
// agent that is not yours (Harbor refuses those). An agent added here may be
// asked by everyone in the space; its owner narrows that from the desktop.
export default function AddPeopleScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; title: string; me: string }>();
  const client = useOrgClient(params.org);

  const [roster, setRoster] = useState<Member[] | null>(null);
  const [inSpace, setInSpace] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([client.listContacts(), client.listMembers(params.space)])
      .then(([{ members: all }, here]) => {
        if (cancelled) return;
        setRoster(all);
        setInSpace(new Set(here.map((m) => m.id)));
      })
      .catch((err) => !cancelled && setError(friendlyError(err)));
    return () => {
      cancelled = true;
    };
  }, [client, params.space]);

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [adding, setAdding] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (roster ?? [])
      .filter((m) =>
        !inSpace.has(m.id) && !isDeparted(m) && (m.kind !== 'agent' || m.ownerId === params.me)
        && (!q || m.displayName.toLowerCase().includes(q)))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [roster, inSpace, query, params.me]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    if (picked.size === 0 || adding) return;
    setAdding(true);
    try {
      await client.addMembers(params.space, [...picked]);
      // The space's cached roster, so the chat names them before its own reload.
      client.listMembers(params.space).then((list) => saveRoster(params.org, params.space, list)).catch(() => {});
      router.back();
    } catch (err) {
      Alert.alert("Couldn't add them", friendlyError(err));
      setAdding(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
    >
      <Stack.Screen
        options={{
          title: `Add to #${params.title}`,
          headerRight: () =>
            adding ? (
              <ActivityIndicator />
            ) : (
              <Pressable hitSlop={10} disabled={picked.size === 0} onPress={() => void add()}>
                <Text style={{ ...type.bodyStrong, color: picked.size === 0 ? colors.tertiaryLabel : colors.label }}>
                  {picked.size > 1 ? `Add ${picked.size}` : 'Add'}
                </Text>
              </Pressable>
            ),
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name"
          placeholderTextColor={colors.tertiaryLabel}
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.label }}
        />
      </View>

      {roster === null && !error ? <ActivityIndicator /> : null}
      {error ? <Text selectable style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 4 }}>{error}</Text> : null}
      {roster !== null ? (
        candidates.length > 0 ? (
          <Group footer={`People you share a space with, and your own agents. They'll see #${params.title} in their list.`}>
            {candidates.map((m, i) => (
              <Row key={m.id} first={i === 0} onPress={() => toggle(m.id)}>
                <Avatar id={m.id} name={m.displayName} size={28} url={m.avatarUrl} />
                <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{m.displayName}</Text>
                {m.kind === 'agent' ? <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>Agent</Text> : null}
                <Tick on={picked.has(m.id)} />
              </Row>
            ))}
          </Group>
        ) : (
          <Text style={{ ...type.body, textAlign: 'center', color: colors.tertiaryLabel, paddingTop: 24 }}>
            {query.trim() ? 'No one matches.' : `Everyone you know is already in #${params.title}. Invite someone new with the space's link.`}
          </Text>
        )
      ) : null}
    </ScrollView>
  );
}
