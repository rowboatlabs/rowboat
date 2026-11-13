import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import type { PlatformInstance, Space } from '@rowboat/spaces-protocol';

import { Field, PersonalityFields } from '@/components/agent-form';
import { Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import { Image } from '@/components/sf-image';
import { CONNECT_SETUPS, routeText, shortened, type SetupStep, type SetupValue } from '@/lib/spaces/agent-setups';
import { kindLabel } from '@/lib/spaces/agents';
import { friendlyError } from '@/lib/spaces/errors';
import { markSpacesChanged, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Connect an agent you already run (2026-11-13, desktop agents-dialog.tsx
// "Connect an agent you run" and agent-setup.tsx ConnectAgent). Pick where it
// runs (Hermes, Replicas, Agent37, Maritime, Conductor, Custom), name it, give
// it a description and personality, paste the platform's key when it has
// one, and pick the spaces and DM it joins. Harbor adds it (addAgent) and
// returns its key once; the screen then shows that platform's setup steps
// with the key filled in, each with Copy, and Copy all / Share for pasting on
// the computer or server that runs the agent. Everything here goes through
// Harbor, Agent37 and Maritime instance lookups included (since 2026-11-02),
// so nothing needs the desktop.

type InstanceChoice =
  | { type: 'existing'; id: string; kind: string; name: string | null }
  | { type: 'new'; kind: string; monthlyBudgetUsd: number; autoSleep: boolean };

interface Created {
  agentId: string;
  agentName: string;
  secret: string;
  setupId: string;
  kind: string;
  instance?: string;
  homeChannel?: string;
}

/** The smallest Agent37 shape per month (desktop agent-instance-picker.tsx). */
const AGENT37_FROM = '$4.76';
const AGENT37_NEW_KINDS = ['hermes', 'openclaw'];
const MARITIME_KINDS = ['hermes', 'claude-code', 'codex'];
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export default function ConnectAgentScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(params.org);
  const orgUrl = `https://${params.org}`;

  const [spaces, setSpaces] = useState<Space[]>([]);
  useEffect(() => {
    let cancelled = false;
    client
      .listSpaces()
      .then((list) => !cancelled && setSpaces(list.filter((s) => s.kind !== 'direct' && !s.archived).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const [setupId, setSetupId] = useState(CONNECT_SETUPS[0]!.id);
  const setup = CONNECT_SETUPS.find((s) => s.id === setupId) ?? CONNECT_SETUPS[0]!;
  const [chosenKind, setChosenKind] = useState<string | null>(null);
  const [credential, setCredential] = useState('');
  const [instance, setInstance] = useState<InstanceChoice | null>(null);
  // An agent that is one platform instance runs whatever its instance runs.
  const kind = setup.bindsInstance ? instance?.kind ?? setup.kinds[0]! : chosenKind && setup.kinds.includes(chosenKind) ? chosenKind : setup.kinds[0]!;
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const shownName = nameEdited ? name : setup.defaultName || kindLabel(kind);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [withDirect, setWithDirect] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const ready =
    shownName.trim() !== '' &&
    (!setup.credential || credential.trim() !== '') &&
    (!setup.bindsInstance || (instance !== null && (instance.type === 'existing' || Number.isFinite(instance.monthlyBudgetUsd))));

  const pickSetup = (id: string) => {
    setSetupId(id);
    setChosenKind(null);
    setCredential('');
    setInstance(null);
    setError(null);
  };

  const toggle = (id: string) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const displayName = shownName.trim();
    let agentId: string;
    let secret: string;
    let agentInstance: string | undefined;
    try {
      // A new Agent37 instance is created first, with the key being pasted; Harbor then checks it like any other.
      let instanceId: string | undefined;
      if (setup.id === 'agent37' && instance?.type === 'new') {
        setProgress('Creating the Agent37 instance… this can take a few minutes.');
        const made = await client.createSetupInstance('agent37', {
          key: credential.trim(),
          kind: instance.kind,
          name: `rowboat-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agent'}`,
          monthlyBudgetUsd: instance.monthlyBudgetUsd,
          autoSleep: instance.autoSleep,
        });
        // If adding fails after this, the instance exists: keep it picked so a retry doesn't create another.
        setInstance({ type: 'existing', id: made.id, kind: made.kind ?? instance.kind, name: made.name });
        instanceId = made.id;
        setProgress('Instance created. Adding the agent…');
      } else if (setup.bindsInstance && instance?.type === 'existing') {
        instanceId = instance.id;
      }
      const { agent, key } = await client.addAgent({
        displayName,
        kind,
        connection: setup.connection,
        ...(setup.credential ? { credential: credential.trim() } : {}),
        ...(instanceId ? { instance: instanceId } : {}),
      });
      agentId = agent.id;
      secret = key.secret;
      agentInstance = agent.agentInstance;
    } catch (err) {
      // A refused platform key shows under the form: nothing was created.
      setError(friendlyError(err));
      setBusy(false);
      setProgress(null);
      return;
    }
    setCredential('');

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
    // Hermes's DM with you is its home channel, named in its setup, so it is always opened (desktop ConnectAgent).
    let homeChannel: string | undefined;
    if (setup.wantsHomeChannel) {
      homeChannel = await client.openDirect(agentId).then(({ space }) => space.id, () => undefined);
    } else if (withDirect) {
      await client.openDirect(agentId).catch(() => missed.push('your direct messages'));
    }
    markSpacesChanged(params.org);
    if (missed.length > 0) Alert.alert(`${displayName} was added`, `But it couldn't be added to ${missed.join(', ')}. You can try again from its page.`);

    setBusy(false);
    setProgress(null);
    setCreated({
      agentId,
      agentName: displayName,
      secret,
      setupId: setup.id,
      kind,
      ...(agentInstance ? { instance: agentInstance } : {}),
      ...(homeChannel ? { homeChannel } : {}),
    });
  };

  if (created) {
    return <ConnectSteps org={params.org} me={params.me} orgUrl={orgUrl} created={created} />;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'Connect an agent' }} />

      <Group label="Where it runs" footer="Choose where it runs. The steps to connect it come next, with its key.">
        {CONNECT_SETUPS.map((s, i) => (
          <Row key={s.id} first={i === 0} onPress={() => pickSetup(s.id)}>
            <Glyph icon={s.id === 'custom' ? 'sf:puzzlepiece.extension' : 'sf:link'} />
            <Text style={{ flex: 1, paddingVertical: 10 }}>
              <Text style={{ ...type.body, color: colors.label }}>{s.label}</Text>
              {'\n'}
              <Text style={{ ...type.caption, color: colors.secondaryLabel }}>{s.description}</Text>
            </Text>
            {s.id === setup.id ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
          </Row>
        ))}
      </Group>

      {setup.kinds.length > 1 && !setup.bindsInstance ? (
        <Group label={setup.kindChoice ?? 'Agent'}>
          {setup.kinds.map((k, i) => (
            <Row key={k} first={i === 0} onPress={() => setChosenKind(k)}>
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>{kindLabel(k)}</Text>
              {k === kind ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
            </Row>
          ))}
        </Group>
      ) : null}

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

      {setup.credential ? (
        <Field
          label={setup.credential.label}
          value={credential}
          onChangeText={(text) => {
            setCredential(text);
            setError(null);
          }}
          placeholder={setup.credential.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="none"
          note={setup.credential.note}
        />
      ) : null}

      {setup.id === 'agent37' || setup.id === 'maritime' ? (
        <InstancePicker
          key={setup.id}
          connection={setup.id}
          credential={credential}
          choice={instance}
          onChoice={setInstance}
          find={(key) => client.setupInstances(setup.id, key)}
        />
      ) : null}

      {setup.wantsHomeChannel && spaces.length === 0 ? null : <Group
        label="Add it to"
        footer={
          setup.wantsHomeChannel
            ? 'Anyone in these spaces can mention it. Your direct messages with it are opened for its setup. You can add it to more later.'
            : 'Anyone in these spaces can mention it; you can narrow that per space from its page. You can add it to more later.'
        }
      >
        {setup.wantsHomeChannel ? null : (
          <Row first onPress={() => setWithDirect((v) => !v)}>
            <Glyph icon="sf:bubble.left" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Direct message</Text>
            <Tick on={withDirect} />
          </Row>
        )}
        {spaces.map((s, i) => (
          <Row key={s.id} first={setup.wantsHomeChannel === true && i === 0} onPress={() => toggle(s.id)}>
            <Glyph icon="sf:number" />
            <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{s.name}</Text>
            <Tick on={!skipped.has(s.id)} />
          </Row>
        ))}
      </Group>}

      {progress ? <Text style={{ ...type.caption, color: colors.secondaryLabel, paddingHorizontal: 16 }}>{progress}</Text> : null}
      {error ? <Text selectable style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 16 }}>{error}</Text> : null}

      <PrimaryButton label={busy ? 'Adding' : 'Add agent'} busy={busy} disabled={!ready} onPress={() => void add()} />
    </ScrollView>
  );
}

/**
 * Which Agent37 instance or Maritime agent the new agent is (desktop
 * agent-instance-picker.tsx and agent-maritime-picker.tsx): one the pasted key
 * reaches, or on Agent37 a new one, billed to the person's Agent37 wallet with
 * the monthly model budget they set. It can't be changed later.
 */
function InstancePicker({ connection, credential, choice, onChoice, find }: {
  connection: 'agent37' | 'maritime';
  credential: string;
  choice: InstanceChoice | null;
  onChoice: (choice: InstanceChoice | null) => void;
  find: (key: string) => Promise<PlatformInstance[]>;
}) {
  const colors = useColors();
  const agent37 = connection === 'agent37';
  const [found, setFound] = useState<{ key: string; list: PlatformInstance[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState('5');
  const key = credential.trim();
  // A different key reaches different instances: what was found is for the key it was found with.
  const list = found?.key === key ? found.list : null;
  const picked = choice?.type === 'existing' ? list?.find((i) => i.id === choice.id) : undefined;
  const newChoice = choice?.type === 'new' ? choice : null;
  const setNew = (patch: Partial<Extract<InstanceChoice, { type: 'new' }>>) =>
    onChoice({ type: 'new', kind: newChoice?.kind ?? 'hermes', monthlyBudgetUsd: newChoice?.monthlyBudgetUsd ?? (Number(budget) || 0), autoSleep: newChoice?.autoSleep ?? true, ...patch });

  const search = async () => {
    if (!key || loading) return;
    setLoading(true);
    setError(null);
    onChoice(null);
    try {
      const instances = await find(key);
      setFound({ key, list: instances });
      if (agent37) {
        const usable = instances.filter((i) => i.kind);
        if (usable.length === 1) onChoice({ type: 'existing', id: usable[0]!.id, kind: usable[0]!.kind!, name: usable[0]!.name });
        else if (usable.length === 0) onChoice({ type: 'new', kind: 'hermes', monthlyBudgetUsd: 5, autoSleep: true });
      } else if (instances.length === 1) {
        onChoice({ type: 'existing', id: instances[0]!.id, kind: instances[0]!.kind ?? 'hermes', name: instances[0]!.name });
      }
    } catch (err) {
      setFound(null);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const label = agent37 ? 'Instance' : 'Maritime agent';
  const footer = agent37
    ? 'The agent is one Agent37 instance, with its own memory and files. Pick one this key reaches, or create one. It can’t be changed later.'
    : 'The agent is one Maritime agent, a VM with its own files and memory. Pick one this key reaches. It can’t be changed later.';

  return (
    <>
      <Group label={label} footer={error ?? footer}>
        {list === null ? (
          <Row first onPress={key && !loading ? () => void search() : undefined}>
            {loading ? <ActivityIndicator style={{ width: 28 }} /> : <Glyph icon="sf:magnifyingglass" />}
            <Text style={{ flex: 1, ...type.body, color: key ? colors.accent : colors.tertiaryLabel }}>
              {key ? (agent37 ? 'Find instances' : 'Find agents') : 'Paste the key first'}
            </Text>
          </Row>
        ) : list.length === 0 && !agent37 ? (
          <Row first>
            <Text style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.secondaryLabel }}>This key reaches no agents. Create one on Maritime first.</Text>
          </Row>
        ) : (
          <>
            {list.map((i, n) => {
              const usable = !agent37 || !!i.kind;
              const on = choice?.type === 'existing' && choice.id === i.id;
              return (
                <Row
                  key={i.id}
                  first={n === 0}
                  disabled={!usable}
                  onPress={() => usable && onChoice({ type: 'existing', id: i.id, kind: i.kind ?? (choice?.type === 'existing' ? choice.kind : 'hermes'), name: i.name })}
                >
                  <View style={{ flex: 1, paddingVertical: 8 }}>
                    <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>{i.name || i.id}</Text>
                    <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>
                      {i.kind ? `${kindLabel(i.kind)} · ${i.status}` : agent37 ? `${i.template}: not Hermes or OpenClaw` : `${i.template} · ${i.status}`}
                    </Text>
                  </View>
                  {on ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
                </Row>
              );
            })}
            {agent37 ? (
              <Row first={list.length === 0} onPress={() => setNew({})}>
                <Glyph icon="sf:plus" />
                <Text style={{ flex: 1, ...type.body, color: colors.label }}>A new instance</Text>
                {newChoice ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
              </Row>
            ) : null}
          </>
        )}
      </Group>

      {picked && !picked.kind && !agent37 ? (
        <Group label="It runs" footer="Maritime doesn’t say what this agent runs. Which is it?">
          {MARITIME_KINDS.map((k, n) => (
            <Row key={k} first={n === 0} onPress={() => onChoice({ type: 'existing', id: picked.id, kind: k, name: picked.name })}>
              <Text style={{ flex: 1, ...type.body, color: colors.label }}>{kindLabel(k)}</Text>
              {choice?.type === 'existing' && choice.kind === k ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
            </Row>
          ))}
        </Group>
      ) : null}

      {newChoice ? (
        <>
          <Group label="New instance runs">
            {AGENT37_NEW_KINDS.map((k, n) => (
              <Row key={k} first={n === 0} onPress={() => setNew({ kind: k })}>
                <Text style={{ flex: 1, ...type.body, color: colors.label }}>{kindLabel(k)}</Text>
                {newChoice.kind === k ? <Image source="sf:checkmark" style={{ width: 15, height: 15 }} tintColor={colors.accent} /> : null}
              </Row>
            ))}
          </Group>
          <Field
            label="Monthly model budget ($)"
            value={budget}
            onChangeText={(text) => {
              setBudget(text);
              const n = Number(text);
              if (text.trim() !== '' && Number.isFinite(n) && n >= 0) setNew({ monthlyBudgetUsd: n });
            }}
            keyboardType="decimal-pad"
          />
          <Group footer={`Billed to your Agent37 wallet: compute from ${AGENT37_FROM} a month (disk only while asleep), plus model spend up to the budget. Creating it can take a few minutes.`}>
            <Row first onPress={() => setNew({ autoSleep: !newChoice.autoSleep })}>
              <Text style={{ flex: 1, paddingVertical: 10, ...type.body, color: colors.label }}>Sleep when idle</Text>
              <Tick on={newChoice.autoSleep} />
            </Row>
          </Group>
        </>
      ) : null}
    </>
  );
}

/**
 * The new agent's setup steps, with its key filled in (desktop ConnectAgent).
 * The key is shown this once: Back is off, and Done leaves for the agent's page.
 */
function ConnectSteps({ org, me, orgUrl, created }: { org: string; me: string; orgUrl: string; created: Created }) {
  const colors = useColors();
  const setup = CONNECT_SETUPS.find((s) => s.id === created.setupId) ?? CONNECT_SETUPS[CONNECT_SETUPS.length - 1]!;
  const routes = setup.setup({
    orgUrl,
    agentKey: created.secret,
    kind: created.kind,
    ...(created.instance ? { instance: created.instance } : {}),
    ...(created.homeChannel ? { homeChannel: created.homeChannel } : {}),
  });
  const [routeId, setRouteId] = useState(routes[0]!.id);
  const route = routes.find((r) => r.id === routeId) ?? routes[0]!;
  const all = routeText(created.agentName, setup.label, route, setup.docsUrl);

  const done = () => {
    router.dismissTo({ pathname: '/spaces/agents', params: { org, me } });
    router.push({ pathname: '/spaces/agent', params: { org, me, agent: created.agentId, title: created.agentName } });
  };
  const confirmDone = () =>
    Alert.alert('Copied what you need?', 'Its key won’t be shown again. If you lose it, make a new one from the desktop app.', [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Done', onPress: done },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 20 }}>
      <Stack.Screen
        options={{
          title: `Connect ${created.agentName}`,
          gestureEnabled: false,
          headerBackVisible: false,
          headerRight: () => (
            <Pressable hitSlop={10} onPress={confirmDone}>
              <Text style={{ ...type.bodyStrong, color: colors.label }}>Done</Text>
            </Pressable>
          ),
        }}
      />

      <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.card }}>
        <Image source="sf:key.fill" style={{ width: 17, height: 17, marginTop: 1 }} tintColor={colors.accent} />
        <Text style={{ flex: 1, ...type.body, color: colors.label }}>
          This is the only time its key is shown. Copy or share these steps now, then finish them on the computer or server that runs {created.agentName}.
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <SmallButton icon="sf:doc.on.doc" label="Copy all" onPress={() => copy(all)} />
        <SmallButton icon="sf:square.and.arrow.up" label="Share" onPress={() => void Share.share({ message: all, title: `Connect ${created.agentName}` })} />
      </View>

      {routes.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: 4, padding: 3, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.card, alignSelf: 'flex-start' }}>
          {routes.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => setRouteId(r.id)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, backgroundColor: r.id === route.id ? colors.secondaryBackground : 'transparent' }}
            >
              <Text style={{ ...type.caption, fontWeight: r.id === route.id ? '600' : '400', color: r.id === route.id ? colors.label : colors.secondaryLabel }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {route.steps.map((step, i) => (
        <StepCard key={`${route.id}-${i}`} n={i + 1} step={step} />
      ))}
      <StepCard
        n={route.steps.length + 1}
        step={{ title: 'Mention it in a space', note: `${created.agentName} is in the spaces you picked. Add it to more from a space’s Add people, then mention it there.` }}
      />

      <Text style={{ ...type.caption, color: colors.secondaryLabel, paddingHorizontal: 16 }}>Long values are shortened on screen; Copy copies them in full.</Text>
      {setup.docsUrl ? (
        <Pressable onPress={() => void WebBrowser.openBrowserAsync(setup.docsUrl!)} style={{ paddingHorizontal: 16 }}>
          <Text style={{ ...type.caption, color: colors.accent }}>{setup.label} setup docs</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function copy(text: string) {
  void Clipboard.setStringAsync(text);
}

function SmallButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12,
        borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card, opacity: pressed ? 0.6 : 1,
      })}
    >
      <Image source={icon} style={{ width: 15, height: 15 }} tintColor={colors.label} />
      <Text style={{ ...type.bodyStrong, color: colors.label }}>{label}</Text>
    </Pressable>
  );
}

function CopyButton({ text }: { text: string }) {
  const colors = useColors();
  const [copied, setCopied] = useState(false);
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        copy(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Text style={{ ...type.caption, fontWeight: '600', color: colors.accent }}>{copied ? 'Copied' : 'Copy'}</Text>
    </Pressable>
  );
}

function StepCard({ n, step }: { n: number; step: SetupStep }) {
  const colors = useColors();
  return (
    <View style={{ gap: 8, padding: 14, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.card }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground }}>
          <Text style={{ ...type.caption, fontWeight: '600', color: colors.secondaryLabel }}>{n}</Text>
        </View>
        <Text style={{ flex: 1, ...type.bodyStrong, color: colors.label }}>{step.title}</Text>
      </View>
      {step.note ? <Text style={{ ...type.caption, lineHeight: 18, color: colors.secondaryLabel }}>{step.note}</Text> : null}
      {step.code ? (
        <View style={{ borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.groupedBackground, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 11, color: colors.secondaryLabel }}>{step.code.caption}</Text>
            <CopyButton text={step.code.text} />
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 12, lineHeight: 18, color: colors.label, padding: 12 }}>
            {step.code.secret ? shortened(step.code.text) : step.code.text}
          </Text>
        </View>
      ) : null}
      {step.valuesNote ? <Text style={{ ...type.caption, color: colors.secondaryLabel }}>{step.valuesNote}</Text> : null}
      {step.values?.map((value, i) => <ValueRow key={i} value={value} />)}
    </View>
  );
}

function ValueRow({ value }: { value: SetupValue }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.groupedBackground }}>
      <View style={{ flex: 1 }}>
        {value.label ? <Text style={{ fontFamily: MONO, fontSize: 11, color: colors.secondaryLabel }}>{value.label}</Text> : null}
        <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 12, color: colors.label }}>{value.secret ? shortened(value.text) : value.text}</Text>
      </View>
      <CopyButton text={value.text} />
    </View>
  );
}
