import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { AgentListing, Space } from '@rowboat/spaces-protocol';

import { Field, PersonalityFields } from '@/components/agent-form';
import { Avatar } from '@/components/avatar';
import { Chevron, Glyph, Group, Row } from '@/components/grouped';
import { StatusBanner } from '@/components/status-banner';
import { HOSTING_POLL_MS, LOCAL_CONNECTION, MOVING_HOSTING, agentLabel, fundingLine, hostingLine } from '@/lib/spaces/agents';
import { saveRoster } from '@/lib/spaces/cache';
import { friendlyError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

type Seat = 'owner' | 'members';
/** One of your spaces, and the agent's seat there when it is in it; `admin` = you may take it out. */
type Place = { space: Space; seat: Seat | null; admin: boolean };

// One agent's page (2026-11-13, desktop agent-page.tsx Overview and Danger
// zone): its owner renames it, edits its description and personality, picks
// which spaces it is in and who may ask it in each (Harbor spec §4 Agent
// members, 2026-11-09: a seat per space), and deletes it (#1379: any agent
// its owner made). A managed agent shows where its machine stands, polled
// while it moves, and who pays for its model. The desktop's keys, setup
// steps, option defaults and the machine's own tabs (terminal, files, logs,
// environment, model key) stay on the desktop. Taking an agent out of a space
// is for that space's admins, as Harbor rules.
export default function AgentScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string; agent: string; title?: string }>();
  const client = useOrgClient(params.org);

  const [listing, setListing] = useState<AgentListing | null | undefined>(undefined);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loadAgent = useCallback(async () => {
    try {
      const all = await client.listAgents();
      setListing(all.find((l) => l.agent.id === params.agent) ?? null);
      setError(null);
    } catch (err) {
      setError(err);
      setListing((prev) => prev ?? null);
    }
  }, [client, params.agent]);

  // Where it is: the shared spaces you are in, each roster read for its seat and your role.
  const loadPlaces = useCallback(async () => {
    try {
      const spaces = (await client.listSpaces()).filter((s) => s.kind !== 'direct' && !s.archived).sort((a, b) => a.name.localeCompare(b.name));
      const rosters = await Promise.all(spaces.map((s) => client.listMembers(s.id).catch(() => null)));
      setPlaces(
        spaces.flatMap((space, i) => {
          const roster = rosters[i];
          if (!roster) return [];
          const row = roster.find((m) => m.id === params.agent);
          const mine = roster.find((m) => m.id === params.me);
          return [{ space, seat: row ? (row.invocableBy ?? 'members') : null, admin: mine?.role === 'admin' }];
        }),
      );
    } catch (err) {
      setError(err);
      setPlaces((prev) => prev ?? []);
    }
  }, [client, params.agent, params.me]);

  useFocusEffect(
    useCallback(() => {
      void loadAgent();
      void loadPlaces();
    }, [loadAgent, loadPlaces]),
  );

  const hosting = listing?.hosting;
  const moving = hosting ? MOVING_HOSTING.has(hosting.status) : false;
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void loadAgent(), HOSTING_POLL_MS);
    return () => clearInterval(timer);
  }, [moving, loadAgent]);

  if (listing === undefined) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 32 }}>
        <Stack.Screen options={{ title: params.title ?? '' }} />
        <ActivityIndicator />
      </ScrollView>
    );
  }
  if (listing === null) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 12 }}>
        <Stack.Screen options={{ title: params.title ?? '' }} />
        <StatusBanner error={error} />
        {!error ? <Text style={{ ...type.body, textAlign: 'center', color: colors.secondaryLabel }}>This agent is gone, or isn’t yours.</Text> : null}
      </ScrollView>
    );
  }

  return (
    <AgentPage
      key={`${listing.agent.displayName}|${listing.agent.title ?? ''}|${listing.agent.instructions ?? ''}`}
      org={params.org}
      me={params.me}
      client={client}
      listing={listing}
      places={places}
      error={error}
      onChanged={loadAgent}
      onPlacesChanged={loadPlaces}
    />
  );
}

/** The page proper, keyed on the saved name and profile: a save resets the form to them. */
function AgentPage({ org, me, client, listing, places, error, onChanged, onPlacesChanged }: {
  org: string;
  me: string;
  client: ReturnType<typeof useOrgClient>;
  listing: AgentListing;
  places: Place[] | null;
  error: unknown;
  onChanged: () => Promise<void>;
  onPlacesChanged: () => Promise<void>;
}) {
  const colors = useColors();
  const { agent, hosting } = listing;
  const mine = agent.ownerId === me;
  const gone = hosting?.status === 'deleting' || hosting?.status === 'deleted' || !!agent.deactivatedAt || !!agent.removedAt;
  const editable = mine && !gone;
  const local = agent.agentConnection === LOCAL_CONNECTION;
  const moving = hosting ? MOVING_HOSTING.has(hosting.status) : false;

  const [name, setName] = useState(agent.displayName);
  const [title, setTitle] = useState(agent.title ?? '');
  const [instructions, setInstructions] = useState(agent.instructions ?? '');
  const [saving, setSaving] = useState(false);
  const nameChanged = name.replace(/\s+/g, ' ').trim() !== agent.displayName;
  const profileChanged = title.trim() !== (agent.title ?? '') || instructions.trim() !== (agent.instructions ?? '');
  const dirty = editable && (nameChanged || profileChanged) && name.trim() !== '';

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      if (nameChanged) await client.renameAgent(agent.id, name.replace(/\s+/g, ' ').trim());
      // An empty field clears it (api.ts setAgentProfile).
      if (profileChanged) await client.setAgentProfile(agent.id, { title: title.trim(), instructions: instructions.trim() });
      await onChanged();
    } catch (err) {
      Alert.alert("Couldn't save", friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const [busySpace, setBusySpace] = useState<string | null>(null);
  const changePlace = async (spaceId: string, run: () => Promise<unknown>, failure: string) => {
    if (busySpace) return;
    setBusySpace(spaceId);
    try {
      await run();
      markSpacesChanged(org);
      // The space's cached roster, so its chat names the agent before its own reload.
      client.listMembers(spaceId).then((list) => saveRoster(org, spaceId, list)).catch(() => {});
      await onPlacesChanged();
    } catch (err) {
      Alert.alert(failure, friendlyError(err));
    } finally {
      setBusySpace(null);
    }
  };

  const openPlace = (place: Place) => {
    const { space, seat, admin } = place;
    if (!editable) return;
    if (seat === null) {
      void changePlace(space.id, () => client.addMembers(space.id, [agent.id]), `Couldn't add it to #${space.name}`);
      return;
    }
    // A local agent's seat is its owner's alone wherever it sits: nothing to switch (desktop SeatsSection).
    const seatButtons = local
      ? []
      : ([
          { text: `${seat === 'members' ? '✓ ' : ''}Everyone here`, onPress: () => seat !== 'members' && void changePlace(space.id, () => client.setAgentAccess(space.id, agent.id, 'members'), 'Couldn’t change who can ask it') },
          { text: `${seat === 'owner' ? '✓ ' : ''}Only me`, onPress: () => seat !== 'owner' && void changePlace(space.id, () => client.setAgentAccess(space.id, agent.id, 'owner'), 'Couldn’t change who can ask it') },
        ] as const);
    const removeButton = admin
      ? [{ text: `Remove from #${space.name}`, style: 'destructive' as const, onPress: () => void changePlace(space.id, () => client.removeMember(space.id, agent.id), `Couldn't remove it from #${space.name}`) }]
      : [];
    if (seatButtons.length === 0 && removeButton.length === 0) return;
    Alert.alert(
      `#${space.name}`,
      local ? 'It runs on your computer, so only you can ask it here.' : 'Who can ask it here? Everyone sees it and its replies.',
      [...seatButtons, ...removeButton, { text: 'Cancel', style: 'cancel' }],
    );
  };

  const [opening, setOpening] = useState(false);
  const message = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const { space } = await client.openDirect(agent.id);
      router.push({ pathname: '/spaces/chat', params: { org, space: space.id, title: agent.displayName, me, kind: 'direct' } });
    } catch (err) {
      Alert.alert("Couldn't open a conversation", friendlyError(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 24 }}
    >
      <Stack.Screen
        options={{
          title: agent.displayName,
          headerRight: () =>
            saving ? (
              <ActivityIndicator />
            ) : dirty ? (
              <Pressable hitSlop={10} onPress={() => void save()}>
                <Text style={{ ...type.bodyStrong, color: colors.label }}>Save</Text>
              </Pressable>
            ) : null,
        }}
      />
      <StatusBanner error={error} />

      <View style={{ alignItems: 'center', gap: 8 }}>
        <Avatar id={agent.id} name={agent.displayName} size={72} url={agent.avatarUrl} />
        <Text style={{ ...type.title, color: colors.label }}>{agent.displayName}</Text>
        <Text style={{ ...type.caption, color: colors.secondaryLabel }}>{agentLabel(agent)}{hosting ? ' · Run by Rowboat' : ''}</Text>
      </View>

      {hosting ? (
        <Group label="Machine">
          <Row first>
            {moving ? <ActivityIndicator /> : <Glyph icon={hosting.status === 'failed' ? 'sf:exclamationmark.triangle' : 'sf:cloud'} tint={hosting.status === 'failed' ? colors.destructive : undefined} />}
            <Text selectable style={{ flex: 1, paddingVertical: 12, ...type.body, color: hosting.status === 'failed' ? colors.destructive : colors.label }}>{hostingLine(hosting)}</Text>
          </Row>
          {!gone && hosting.externalId ? (
            <Row>
              <Glyph icon="sf:creditcard" />
              <Text style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.label }}>{fundingLine(hosting)}</Text>
            </Row>
          ) : null}
        </Group>
      ) : null}

      {!gone ? (
        <Group>
          <Row first onPress={() => void message()} disabled={opening}>
            <Glyph icon="sf:bubble.left" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Message {agent.displayName}</Text>
            {opening ? <ActivityIndicator /> : <Chevron />}
          </Row>
        </Group>
      ) : null}

      {editable ? (
        <>
          <Field label="Name" value={name} onChangeText={setName} maxLength={128} autoCorrect={false} note="How it appears in Spaces, and what people type to mention it." />
          <PersonalityFields title={title} onTitle={setTitle} instructions={instructions} onInstructions={setInstructions} editable={!saving} />
          <Text style={{ ...type.caption, color: colors.secondaryLabel, paddingHorizontal: 16, marginTop: -16 }}>It reads its personality before every request. Changes apply from the next mention.</Text>
        </>
      ) : agent.title || agent.instructions ? (
        <Group label="Description and personality">
          {agent.title ? (
            <Row first>
              <Text selectable style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.label }}>{agent.title}</Text>
            </Row>
          ) : null}
          {agent.instructions ? (
            <Row first={!agent.title}>
              <Text selectable style={{ flex: 1, paddingVertical: 12, ...type.caption, color: colors.secondaryLabel }}>{agent.instructions}</Text>
            </Row>
          ) : null}
        </Group>
      ) : null}

      {!gone ? (
        places === null ? (
          <ActivityIndicator />
        ) : places.length > 0 ? (
          <Group
            label="Where it works"
            footer={
              local
                ? 'Tap a space to add it. It runs on your computer, so only you can ask it, wherever it is.'
                : 'Tap a space to add it, or to choose who can ask it there. Only a space’s admins can take it out.'
            }
          >
            {places.map((place, i) => (
              <Row key={place.space.id} first={i === 0} disabled={busySpace === place.space.id} {...(editable ? { onPress: () => openPlace(place) } : {})}>
                <Glyph icon="sf:number" />
                <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{place.space.name}</Text>
                {busySpace === place.space.id ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={{ ...type.caption, color: place.seat ? colors.secondaryLabel : colors.tertiaryLabel }}>
                    {place.seat === null ? (editable ? 'Add' : 'Not in it') : place.seat === 'owner' || local ? 'Only you' : 'Everyone'}
                  </Text>
                )}
              </Row>
            ))}
          </Group>
        ) : (
          <Text style={{ ...type.caption, color: colors.secondaryLabel, paddingHorizontal: 16 }}>You’re in no spaces yet. Create one and add it there.</Text>
        )
      ) : null}

      {editable ? <DeleteAgent client={client} agentId={agent.id} name={agent.displayName} hosted={!!hosting} local={local} org={org} /> : null}
    </ScrollView>
  );
}

/**
 * Delete it (desktop DeleteAgentRow; #1379, 2026-11-13: any agent its owner
 * made): the person types its name first, as on the desktop. A managed one
 * leaves its machine too. A local one's key and folder stay on the computer
 * that ran it until the desktop app there forgets it.
 */
function DeleteAgent({ client, agentId, name, hosted, local, org }: {
  client: ReturnType<typeof useOrgClient>;
  agentId: string;
  name: string;
  hosted: boolean;
  local: boolean;
  org: string;
}) {
  const colors = useColors();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === name;

  const remove = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await client.deleteAgent(agentId);
      markSpacesChanged(org);
      router.back();
    } catch (err) {
      Alert.alert("Couldn't delete the agent", friendlyError(err));
      setBusy(false);
    }
  };

  const note = hosted
    ? 'Deletes its machine, revokes every key, removes it from all spaces and makes its DMs read-only. Its messages stay.'
    : local
      ? 'Revokes every key, removes it from all spaces and makes its DMs read-only. Its messages stay. Your computer stops running it.'
      : 'Revokes every key, removes it from all spaces and makes its DMs read-only. Its messages stay.';

  return (
    <Group label="Delete" footer={note}>
      {confirming ? (
        <>
          <Row first>
            <TextInput
              autoFocus
              value={typed}
              onChangeText={setTyped}
              placeholder={`Type ${name} to confirm`}
              placeholderTextColor={colors.tertiaryLabel}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={() => void remove()}
              style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.label }}
            />
          </Row>
          <Row onPress={() => void remove()} disabled={!matches || busy}>
            <Glyph icon="sf:trash" tint={colors.destructive} />
            <Text style={{ flex: 1, ...type.bodyStrong, color: colors.destructive }}>{busy ? 'Deleting…' : `Delete ${name}`}</Text>
          </Row>
          <Row onPress={() => (setConfirming(false), setTyped(''))}>
            <Glyph icon="sf:xmark" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Cancel</Text>
          </Row>
        </>
      ) : (
        <Row first onPress={() => setConfirming(true)}>
          <Glyph icon="sf:trash" tint={colors.destructive} />
          <Text style={{ flex: 1, ...type.body, color: colors.destructive }}>Delete agent</Text>
        </Row>
      )}
    </Group>
  );
}
