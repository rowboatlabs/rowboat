import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { Space } from '@rowboat/spaces-protocol';

import { Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import { friendlyError } from '@/lib/spaces/errors';
import { listNames, shareInviteLink, useOrg, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Invite people to the org (2026-11-02, desktop invite-dialog.tsx): pick any
// spaces you're in to bring them straight there; the org's default spaces
// come with every invite, so they're named, not offered. A fresh link is
// minted on Create, and a new pick puts the button back.
// With `space` set (from a space's Members screen) that space is pre-picked.
export default function InviteScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space?: string }>();
  const client = useOrgClient(params.org);
  const org = useOrg(params.org);
  const orgName = org?.name ?? params.org;

  const [mine, setMine] = useState<Space[] | null>(null);
  const [defaults, setDefaults] = useState<Map<string, string>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .listSpaces()
      .then((list) => !cancelled && setMine(list))
      .catch((err) => !cancelled && setError(friendlyError(err)));
    // Defaults you aren't in still count: browse lists every open space.
    client
      .browseSpaces()
      .then(({ spaces }) => {
        if (cancelled) return;
        setDefaults(new Map(spaces.filter(({ space }) => space.isDefault && !space.archived).map(({ space }) => [space.id, space.name])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const allDefaults = useMemo(() => {
    const byId = new Map(defaults);
    for (const s of mine ?? []) if (s.isDefault && !s.archived) byId.set(s.id, s.name);
    return byId;
  }, [mine, defaults]);
  const listable = (mine ?? []).filter((s) => s.kind !== 'direct' && !s.archived && !allDefaults.has(s.id));

  const [chosen, setChosen] = useState<string[]>(() => (params.space ? [params.space] : []));
  const [link, setLink] = useState<{ url: string; admits: string | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const toggle = (id: string) => {
    setLink(null);
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      // Only spaces still offered: a pre-picked one may be a default, which every invite brings anyway.
      const spaceIds = chosen.filter((id) => listable.some((s) => s.id === id));
      const { link: url, token } = await client.createInvite({ spaceIds });
      // What it admits is read back from the invite itself — a nicety; the link works without it.
      const admits = await client.resolveInvite(token).then(
        (r) => r.state === 'ok'
          ? (r.spaces ?? []).length > 0
            ? `Anyone with it can join ${r.org.name} and ${listNames((r.spaces ?? []).map((s) => `#${s.name}`))}.`
            : `Anyone with it can join ${r.org.name}.`
          : null,
        () => null,
      );
      setLink({ url, admits });
      await shareInviteLink(url, orgName).catch(() => {});
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (url: string) => {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: `Invite to ${orgName}` }} />
      <Text style={{ ...type.body, lineHeight: 22, color: colors.secondaryLabel, paddingHorizontal: 4 }}>
        {allDefaults.size > 0
          ? `Everyone you invite joins ${listNames([...allDefaults.values()].map((n) => `#${n}`))}.`
          : `Everyone you invite joins ${orgName} and can browse its open spaces.`}
        {listable.length > 0 ? ' Add spaces to bring them straight there.' : ''}
      </Text>

      {mine === null && !error ? <ActivityIndicator /> : null}
      {listable.length > 0 ? (
        <Group label="Also add them to">
          {listable.map((s, i) => (
            <Row key={s.id} first={i === 0} onPress={() => toggle(s.id)}>
              <Glyph icon={s.visibility === 'open' ? 'sf:number' : 'sf:lock'} />
              <Text numberOfLines={1} style={{ flex: 1, ...type.body, color: colors.label }}>{s.name}</Text>
              <Tick on={chosen.includes(s.id)} />
            </Row>
          ))}
        </Group>
      ) : null}

      {link ? (
        <Group footer={link.admits ?? 'Anyone with it can join.'}>
          <View style={{ padding: 14 }}>
            <Text selectable numberOfLines={2} style={{ fontFamily: 'Menlo', fontSize: 13, color: colors.label }}>{link.url}</Text>
          </View>
          <Row onPress={() => void shareInviteLink(link.url, orgName).catch(() => {})}>
            <Glyph icon="sf:square.and.arrow.up" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Share link</Text>
          </Row>
          <Row onPress={() => void copy(link.url)}>
            <Glyph icon={copied ? 'sf:checkmark' : 'sf:doc.on.doc'} />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>{copied ? 'Copied' : 'Copy link'}</Text>
          </Row>
        </Group>
      ) : (
        <PrimaryButton label={creating ? 'Creating link' : 'Create invite link'} busy={creating} disabled={mine === null} onPress={() => void create()} />
      )}
      {error ? <Text selectable style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 4 }}>{error}</Text> : null}
    </ScrollView>
  );
}
