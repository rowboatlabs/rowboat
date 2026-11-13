import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { Member, Message, Space, TopicListing } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';

import { Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import { Image } from '@/components/sf-image';
import { loadValue, peekRoster, peekValue } from '@/lib/spaces/cache';
import { friendlyError } from '@/lib/spaces/errors';
import { useOrgClient } from '@/lib/spaces/invites';
import { memberLabel } from '@/lib/spaces/profiles';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Forward a message (2026-11-13, the desktop's forward-dialog.tsx): pick a
// destination — this space's messages, one of its discussions, or another
// space or DM — add an optional note, send. The copy is a quoted block with
// attribution, plain markdown on the wire. Attachments live in their own
// space, so a forward to another space carries the words and says so.

interface Destination {
  space: string;
  /** The discussion to land in; absent = the space's messages. */
  threadRoot?: string;
  label: string;
  sub: string;
  kind: 'stream' | 'topic' | 'space' | 'direct';
}

export default function ForwardScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; message: string; me: string }>();
  const { org, space, me } = params;
  const client = useOrgClient(org);
  const [message, setMessage] = useState<Message | null>(null);
  const [topics, setTopics] = useState<TopicListing[]>([]);
  const [all, setAll] = useState<Space[]>(() => peekValue<Space[]>(`spaces:${org}`) ?? []);
  const [rosters, setRosters] = useState<Map<string, Member[]>>(() => new Map(peekValue<[string, Member[]][]>(`orgMembers:${org}`) ?? []));
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Destination | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .getMessage(space, params.message)
      .then((m) => !cancelled && setMessage(m))
      .catch((err) => {
        if (cancelled) return;
        Alert.alert("Couldn't load the message", friendlyError(err));
        router.back();
      });
    client.listTopics(space).then((list) => !cancelled && setTopics(list)).catch(() => {});
    client.listSpaces({ includeDirect: true }).then((list) => !cancelled && setAll(list)).catch(() => {});
    // DMs are named for the other person — Home's saved rosters know them.
    void loadValue<[string, Member[]][]>(`orgMembers:${org}`).then((r) => !cancelled && r && setRosters(new Map(r)));
    return () => {
      cancelled = true;
    };
  }, [client, org, space, params.message]);

  const roster = useMemo(() => peekRoster(org, space) ?? rosters.get(space) ?? [], [org, space, rosters]);
  const memberNames = useMemo(() => new Map(roster.map((m) => [m.id, memberLabel(m)])), [roster]);
  const here = all.find((s) => s.id === space);

  const destinations = useMemo<Destination[]>(() => {
    const dmName = (s: Space) => {
      const people = rosters.get(s.id) ?? [];
      const other = people.find((m) => m.id !== me);
      return other ? memberLabel(other) : people.length ? 'Notes to self' : s.name;
    };
    const hereName = here ? (here.kind === 'direct' ? dmName(here) : `#${here.name}`) : '';
    const out: Destination[] = [{ space, label: 'Messages', sub: hereName, kind: 'stream' }];
    for (const t of topics) {
      if (t.archived) continue;
      out.push({ space, threadRoot: t.rootMessageId, label: spaces.resolveMentions(t.title, memberNames), sub: hereName, kind: 'topic' });
    }
    for (const s of all) {
      if (s.id === space || s.archived) continue;
      out.push(s.kind === 'direct' ? { space: s.id, label: dmName(s), sub: 'Direct message', kind: 'direct' } : { space: s.id, label: `#${s.name}`, sub: 'Space', kind: 'space' });
    }
    return out;
  }, [space, here, topics, all, rosters, me, memberNames]);

  const q = query.trim().toLowerCase();
  const shown = q ? destinations.filter((d) => `${d.label} ${d.sub}`.toLowerCase().includes(q)) : destinations;
  const same = (a: Destination | null, b: Destination) => !!a && a.space === b.space && a.threadRoot === b.threadRoot;

  const send = async () => {
    if (!picked || !message || sending) return;
    setSending(true);
    try {
      const cross = picked.space !== space;
      const authorName = memberNames.get(message.author.memberId) ?? message.author.memberId;
      let text = spaces.resolveMentions(message.body, memberNames).trim();
      let stripped = false;
      if (cross) {
        // Attachment links only open inside their own space.
        const next = text
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/\[[^\]]*\]\([^)]*\/b\/[^)]*\)/g, '')
          .trim();
        stripped = next !== text;
        text = next;
      }
      const quote = (text || '(attachment)').split('\n').map((l) => `> ${l}`).join('\n');
      const from = cross && here ? `, in ${here.kind === 'direct' ? 'a direct message' : here.name}` : '';
      const attribution = `> — ${authorName}${from}${stripped ? ' _(attachments not forwarded)_' : ''}`;
      const body = [note.trim(), `${quote}\n${attribution}`].filter(Boolean).join('\n\n');
      await client.postMessage(picked.space, { body, ...(picked.threadRoot ? { threadRoot: picked.threadRoot } : {}), actingMode: 'direct' });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't forward", friendlyError(err));
      setSending(false);
    }
  };

  const icon = (d: Destination) => (d.kind === 'topic' ? 'sf:number' : d.kind === 'direct' ? 'sf:person' : 'sf:bubble.left.and.bubble.right');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: 'Forward' }} />
      {message === null ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
            <View style={{ width: 3, borderRadius: 2, backgroundColor: colors.separator }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.caption, fontWeight: '600', color: colors.secondaryLabel }}>
                {memberNames.get(message.author.memberId) ?? message.author.memberId}
              </Text>
              <Text numberOfLines={4} style={{ ...type.body, color: colors.label }}>
                {spaces.resolveMentions(message.body, memberNames).replace(/!\[[^\]]*\]\([^)]*\)/g, '(image)').trim() || '(attachment)'}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
            <Image source="sf:magnifyingglass" style={{ width: 15, height: 15 }} tintColor={colors.tertiaryLabel} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search discussions and spaces"
              placeholderTextColor={colors.tertiaryLabel}
              autoCorrect={false}
              style={{ flex: 1, paddingVertical: 12, ...type.body, color: colors.label }}
            />
          </View>

          <Group label="Send to">
            {shown.map((d, i) => (
              <Row key={`${d.space}/${d.threadRoot ?? 'stream'}`} first={i === 0} onPress={() => setPicked(d)}>
                <Glyph icon={icon(d)} />
                <View style={{ flex: 1, paddingVertical: 8 }}>
                  <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>{d.label}</Text>
                  {d.sub ? <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>{d.sub}</Text> : null}
                </View>
                <Tick on={same(picked, d)} />
              </Row>
            ))}
            {shown.length === 0 ? (
              <Text style={{ ...type.caption, color: colors.secondaryLabel, padding: 14 }}>Nothing matches.</Text>
            ) : null}
          </Group>

          <View style={{ paddingHorizontal: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add a note (optional)"
              placeholderTextColor={colors.tertiaryLabel}
              multiline
              style={{ minHeight: 44, maxHeight: 120, paddingVertical: 12, ...type.body, color: colors.label }}
            />
          </View>

          <PrimaryButton
            label={sending ? 'Forwarding' : picked ? `Forward to ${picked.label}` : 'Forward'}
            busy={sending}
            disabled={!picked}
            onPress={() => void send()}
          />
        </>
      )}
    </ScrollView>
  );
}
