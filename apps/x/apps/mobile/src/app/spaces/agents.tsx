import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { AgentListing, Member } from '@rowboat/spaces-protocol';

import { Avatar } from '@/components/avatar';
import { Chevron, Glyph, Group, Row } from '@/components/grouped';
import { StatusBanner } from '@/components/status-banner';
import { HOSTING_POLL_MS, MOVING_HOSTING, agentLabel, hostingStatusShort, isActiveListing } from '@/lib/spaces/agents';
import { useOrgClient } from '@/lib/spaces/invites';
import { isDeparted } from '@/lib/spaces/profiles';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Agents (2026-11-13, desktop agents-view.tsx): the agents you own, what each
// runs on and its one-line description, and New agent: Rowboat runs it, or
// connect one you already run (new-agent.tsx). The desktop's third way, an
// agent on your own computer, is run by the desktop app, so it stays there.
// Below, everyone else's (2026-11-13, Gagan: "I only see my agents"): Harbor
// lists only your own, so, as the desktop does, they come from the rosters of
// the spaces you share, each under its owner's name. Theirs open read-only.
export default function AgentsScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);

  const [agents, setAgents] = useState<AgentListing[] | null>(null);
  const [others, setOthers] = useState<{ agent: Member; owner: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const listing = await client.listAgents();
      setAgents(listing.filter((l) => isActiveListing(l) && l.agent.ownerId === params.me).sort((a, b) => a.agent.displayName.localeCompare(b.agent.displayName)));
      setError(null);
    } catch (err) {
      setError(err);
      setAgents((prev) => prev ?? []);
    }
  }, [client, params.me]);

  // Best-effort: a roster that fails to load only leaves its agents out.
  const loadOthers = useCallback(async () => {
    try {
      const spaces = (await client.listSpaces()).filter((s) => s.kind !== 'direct');
      const rosters = await Promise.all(spaces.map((s) => client.listMembers(s.id).catch((): Member[] => [])));
      const people = new Map<string, string>();
      const found = new Map<string, Member>();
      for (const roster of rosters) {
        for (const m of roster) {
          if (m.kind !== 'agent') people.set(m.id, m.displayName);
          else if (m.ownerId !== params.me && !isDeparted(m)) found.set(m.id, m);
        }
      }
      setOthers(
        [...found.values()]
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((agent) => ({ agent, owner: agent.ownerId ? `${people.get(agent.ownerId) ?? 'Someone else'}’s` : 'Built in' })),
      );
    } catch {
      // Your own list says what went wrong; this one keeps what it had.
    }
  }, [client, params.me]);

  // Reloads on focus: back from creating, renaming or deleting one, the list says so.
  useFocusEffect(
    useCallback(() => {
      void load();
      void loadOthers();
    }, [load, loadOthers]),
  );

  // A new agent is deploying for a minute or three: keep its row fresh until it is ready.
  const moving = agents?.some((a) => a.hosting && MOVING_HOSTING.has(a.hosting.status)) ?? false;
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void load(), HOSTING_POLL_MS);
    return () => clearInterval(timer);
  }, [moving, load]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), loadOthers()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <Stack.Screen options={{ title: 'Agents' }} />
      <StatusBanner error={error} />

      {agents === null ? <ActivityIndicator /> : null}
      {agents !== null && agents.length > 0 ? (
        <Group label={`Your agents · ${agents.length}`}>
          {agents.map(({ agent, hosting }, i) => {
            const status = hosting ? hostingStatusShort(hosting) : null;
            return (
              <Row
                key={agent.id}
                first={i === 0}
                onPress={() => router.push({ pathname: '/spaces/agent', params: { org: params.org, me: params.me, agent: agent.id, title: agent.displayName } })}
              >
                <Avatar id={agent.id} name={agent.displayName} size={28} url={agent.avatarUrl} />
                <View style={{ flex: 1, paddingVertical: 8 }}>
                  <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>{agent.displayName}</Text>
                  <Text numberOfLines={1} style={{ ...type.caption, color: hosting?.status === 'failed' ? colors.destructive : colors.secondaryLabel }}>
                    {status ?? agentLabel(agent)}
                    {agent.title ? ` · ${agent.title}` : ''}
                  </Text>
                </View>
                <Chevron />
              </Row>
            );
          })}
        </Group>
      ) : null}
      {agents !== null && agents.length === 0 && !error ? (
        <Text style={{ ...type.body, textAlign: 'center', color: colors.tertiaryLabel, paddingTop: 8 }}>You have no agents yet.</Text>
      ) : null}

      {agents !== null ? (
        <Group footer="Rowboat runs it in the cloud, or connect one you already run: Hermes, Replicas, Conductor, Agent37, Maritime or your own. To run one on your computer, use the desktop app.">
          <Row first onPress={() => router.push({ pathname: '/spaces/new-agent', params: { org: params.org, me: params.me } })}>
            <Glyph icon="sf:plus" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>New agent</Text>
            <Chevron />
          </Row>
        </Group>
      ) : null}

      {others.length > 0 ? (
        <Group label={`Everyone else’s · ${others.length}`} footer="In spaces you share. Only an agent’s owner can message it or change it.">
          {others.map(({ agent, owner }, i) => (
            <Row
              key={agent.id}
              first={i === 0}
              onPress={() => router.push({ pathname: '/spaces/agent', params: { org: params.org, me: params.me, agent: agent.id, title: agent.displayName } })}
            >
              <Avatar id={agent.id} name={agent.displayName} size={28} url={agent.avatarUrl} />
              <View style={{ flex: 1, paddingVertical: 8 }}>
                <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>{agent.displayName}</Text>
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>
                  {owner} · {agentLabel(agent)}
                  {agent.title ? ` · ${agent.title}` : ''}
                </Text>
              </View>
              <Chevron />
            </Row>
          ))}
        </Group>
      ) : null}
    </ScrollView>
  );
}
