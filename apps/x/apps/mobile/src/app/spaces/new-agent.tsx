import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text } from 'react-native';
import type { Space } from '@rowboat/spaces-protocol';

import { Field, PersonalityFields } from '@/components/agent-form';
import { Chevron, Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import { Image } from '@/components/sf-image';
import { MANAGED_KINDS, kindLabel } from '@/lib/spaces/agents';
import { friendlyError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// New agent (2026-11-13, desktop agents-dialog.tsx "Create an agent"): one
// Rowboat runs for you in the cloud (Harbor createManagedAgent). Pick what it
// runs, a name, an optional description and personality, and where it goes:
// your DM with it and which of your spaces it joins, all by default, as on
// the desktop. Claude Code needs the person's Anthropic key, which goes to the
// agent's machine and nowhere else. The desktop's environment variables are
// left out here: they belong to the machine and are set on the desktop.
// Creating opens the agent's page, which shows it deploying, then ready.
//
// It starts where the desktop's New agent does (2026-11-13, agents-dialog.tsx
// "Where should it run?"): Rowboat runs it, or connect one you already run
// (connect-agent.tsx). The desktop's third way, "On this computer", is an
// agent the desktop app itself runs, so the phone doesn't offer it.
export default function NewAgentScreen() {
  const params = useLocalSearchParams<{ org: string; me: string; path?: string }>();
  return params.path === 'create' ? <CreateAgent /> : <ChoosePath />;
}

function ChoosePath() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);
  // A server with no managed hosting has no "Rowboat runs it" (desktop does the same).
  const [creates, setCreates] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .managedAgentKinds()
      .then(({ kinds }) => !cancelled && setCreates(kinds.some((k) => MANAGED_KINDS.some((m) => m.kind === k))))
      .catch(() => !cancelled && setCreates(false));
    return () => {
      cancelled = true;
    };
  }, [client]);

  const go = (pathname: '/spaces/new-agent' | '/spaces/connect-agent', extra: Record<string, string> = {}) =>
    router.push({ pathname, params: { org: params.org, me: params.me, ...extra } });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 24 }}>
      <Stack.Screen options={{ title: 'New agent' }} />
      {creates === null ? <ActivityIndicator /> : (
        <Group label="Where should it run?" footer="To run one on this computer with your own Claude Code or Codex login, use the desktop app.">
          {creates ? (
            <Row first onPress={() => go('/spaces/new-agent', { path: 'create' })}>
              <Glyph icon="sf:cloud" />
              <Text style={{ flex: 1, paddingVertical: 10 }}>
                <Text style={{ ...type.body, color: colors.label }}>Rowboat runs it</Text>
                {'\n'}
                <Text style={{ ...type.caption, color: colors.secondaryLabel }}>Set up once, use it anytime from any device. Runs in the cloud.</Text>
              </Text>
              <Chevron />
            </Row>
          ) : null}
          <Row first={!creates} onPress={() => go('/spaces/connect-agent')}>
            <Glyph icon="sf:link" />
            <Text style={{ flex: 1, paddingVertical: 10 }}>
              <Text style={{ ...type.body, color: colors.label }}>Connect one you already run</Text>
              {'\n'}
              <Text style={{ ...type.caption, color: colors.secondaryLabel }}>Hermes, Replicas, Conductor, Agent37, Maritime, or a custom agent.</Text>
            </Text>
            <Chevron />
          </Row>
        </Group>
      )}
    </ScrollView>
  );
}

function CreateAgent() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);

  const [kinds, setKinds] = useState<string[] | null>(null);
  const [billing, setBilling] = useState<{ billed: boolean; upgradeUrl?: string }>({ billed: false });
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .managedAgentKinds()
      .then(({ kinds: offered, billed, upgradeUrl }) => {
        if (cancelled) return;
        setKinds(offered.filter((k) => MANAGED_KINDS.some((m) => m.kind === k)));
        setBilling({ billed: billed === true, ...(upgradeUrl ? { upgradeUrl } : {}) });
      })
      .catch((err) => !cancelled && (setKinds([]), setLoadError(friendlyError(err))));
    client
      .listSpaces()
      .then((list) => !cancelled && setSpaces(list.filter((s) => s.kind !== 'direct' && !s.archived).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const offered = MANAGED_KINDS.filter((m) => kinds?.includes(m.kind));
  const [picked, setPicked] = useState<string | null>(null);
  const kind = picked && offered.some((m) => m.kind === picked) ? picked : offered[0]?.kind;
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const shownName = nameEdited ? name : kind ? kindLabel(kind) : '';
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  // Every space unless unticked, and the DM (2026-10-08 on the desktop).
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [withDirect, setWithDirect] = useState(true);
  const [busy, setBusy] = useState(false);

  const ready = !!kind && shownName.trim() !== '' && (kind !== 'claude-code' || anthropicKey.trim() !== '');

  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    if (!ready || busy || !kind) return;
    setBusy(true);
    const displayName = shownName.trim();
    let agentId: string;
    try {
      const { agent } = await client.createManagedAgent({
        displayName,
        kind,
        ...(kind === 'claude-code' ? { anthropicApiKey: anthropicKey.trim() } : {}),
      });
      agentId = agent.id;
    } catch (err) {
      // Past the plan's agents (2026-11-04): Harbor says so, and the way out is the upgrade.
      const message = friendlyError(err);
      const upgradeUrl = billing.upgradeUrl;
      Alert.alert("Couldn't create the agent", message, upgradeUrl && message.startsWith('Your Rowboat plan includes')
        ? [{ text: 'Cancel', style: 'cancel' }, { text: 'Upgrade', onPress: () => void WebBrowser.openBrowserAsync(upgradeUrl) }]
        : undefined);
      setBusy(false);
      return;
    }
    setAnthropicKey('');

    // The agent exists now: what follows can fail without undoing it, and says what was missed.
    const missed: string[] = [];
    const description = title.trim();
    const personality = instructions.trim();
    if (description || personality) {
      await client
        .setAgentProfile(agentId, { ...(description ? { title: description } : {}), ...(personality ? { instructions: personality } : {}) })
        .catch(() => missed.push('its description and personality'));
    }
    const into = spaces.filter((s) => !skipped.has(s.id));
    const joined = await Promise.allSettled(into.map((s) => client.addMembers(s.id, [agentId])));
    joined.forEach((r, i) => r.status === 'rejected' && missed.push(`#${into[i]!.name}`));
    if (withDirect) await client.openDirect(agentId).catch(() => missed.push('your direct messages'));
    if (into.length > 0 || withDirect) markSpacesChanged(params.org);
    if (missed.length > 0) Alert.alert(`${displayName} was created`, `But it couldn't be added to ${missed.join(', ')}. You can try again from its page.`);

    // Past the chooser and the form to the list, then its page: Back from it lands on Agents (2026-11-13).
    router.dismissTo({ pathname: '/spaces/agents', params: { org: params.org, me: params.me } });
    router.push({ pathname: '/spaces/agent', params: { org: params.org, me: params.me, agent: agentId, title: displayName } });
  };

  if (kinds === null) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 32 }}>
        <Stack.Screen options={{ title: 'New agent' }} />
        <ActivityIndicator />
      </ScrollView>
    );
  }

  if (offered.length === 0) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, gap: 12 }}>
        <Stack.Screen options={{ title: 'New agent' }} />
        <Text style={{ ...type.body, textAlign: 'center', color: colors.secondaryLabel }}>
          {loadError ?? 'This server doesn’t run agents for you. Go back and connect one you already run.'}
        </Text>
      </ScrollView>
    );
  }

  const kindLine = (m: (typeof MANAGED_KINDS)[number]) => (billing.billed ? m.billedDescription : m.description);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'New agent' }} />

      <Group
        label="What it runs"
        footer={
          billing.billed
            ? 'Rowboat runs it in the cloud; it’s ready in a minute or two, with nothing to connect. Its machine bills to your Rowboat plan, at cost.'
            : 'Rowboat runs it in the cloud; it’s ready in a minute or two, with nothing to connect.'
        }
      >
        {offered.map((m, i) => (
          <Row key={m.kind} first={i === 0} onPress={() => setPicked(m.kind)}>
            <Glyph icon={m.kind === 'hermes' ? 'sf:sparkles' : 'sf:chevron.left.forwardslash.chevron.right'} />
            <Text style={{ flex: 1, paddingVertical: 10 }}>
              <Text style={{ ...type.body, color: colors.label }}>{kindLabel(m.kind)}</Text>
              {'\n'}
              <Text style={{ ...type.caption, color: colors.secondaryLabel }}>{kindLine(m)}</Text>
            </Text>
            {m.kind === kind ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
          </Row>
        ))}
      </Group>

      <Field
        label="Name"
        value={shownName}
        onChangeText={(text) => {
          setNameEdited(true);
          setName(text);
        }}
        placeholder="e.g. Scout"
        maxLength={128}
        autoCorrect={false}
        note="How it appears in Spaces, and what people type to mention it."
      />

      <PersonalityFields title={title} onTitle={setTitle} instructions={instructions} onInstructions={setInstructions} />

      {kind === 'claude-code' ? (
        <Field
          label="Anthropic API key"
          value={anthropicKey}
          onChangeText={setAnthropicKey}
          placeholder="sk-ant-…"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          note="Claude Code runs on it. It goes to the agent’s machine and nowhere else; Rowboat keeps no copy."
        />
      ) : null}

      <Group
        label="Add it to"
        footer="Anyone in these spaces can mention it; you can narrow that per space from its page. You can add it to more later."
      >
        <Row first onPress={() => setWithDirect((v) => !v)}>
          <Glyph icon="sf:bubble.left" />
          <Text style={{ flex: 1, ...type.body, color: colors.label }}>Direct message</Text>
          <Tick on={withDirect} />
        </Row>
        {spaces.map((s) => (
          <Row key={s.id} onPress={() => toggle(s.id)}>
            <Glyph icon="sf:number" />
            <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{s.name}</Text>
            <Tick on={!skipped.has(s.id)} />
          </Row>
        ))}
      </Group>

      <PrimaryButton label={busy ? 'Creating' : 'Create agent'} busy={busy} disabled={!ready} onPress={() => void create()} />
    </ScrollView>
  );
}
