import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { Glyph, Group, Row } from '@/components/grouped';
import { QrCode } from '@/components/qr-code';
import { friendlyError } from '@/lib/spaces/errors';
import { shareInviteLink, useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// An invite link (2026-11-02; one target since 2026-11-09, desktop's
// invite-link.tsx): with `space`, the space's link — anyone with it is in;
// without, your personal link, which opens a direct message with you. Minted
// as the screen opens; it works for seven days. "Show QR code" (2026-11-10)
// puts the same link on screen for someone in the room to scan with their
// phone's camera. `qr=1` (2026-11-11) opens with the code already showing,
// for the entry points on your profile, where showing it is the point.
export default function InviteScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space?: string; title?: string; qr?: string }>();
  const client = useOrgClient(params.org);
  const direct = !params.space;
  const what = direct ? 'me' : `#${params.title ?? 'the space'}`;

  const [link, setLink] = useState<{ url: string; admits: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(params.qr === '1');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { link: url, token } = await client.createInvite(params.space ? { spaceId: params.space } : { direct: true });
        // What it admits is read back from the invite itself — a nicety; the link works without it.
        const admits = await client.resolveInvite(token).then(
          (r) => r.state === 'ok'
            ? r.space
              ? `Anyone with it can join #${r.space.name}. It works for seven days.`
              : r.direct
                ? 'Anyone with it can message you directly, and you them. It works for seven days.'
                : null
            : null,
          () => null,
        );
        if (!cancelled) setLink({ url, admits });
      } catch (err) {
        if (!cancelled) setError(friendlyError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, params.space]);

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
      <Stack.Screen options={{ title: direct ? 'Your link' : `Invite to ${what}` }} />
      <Text style={{ ...type.body, lineHeight: 22, color: colors.secondaryLabel, paddingHorizontal: 4 }}>
        {direct
          ? 'Share it with anyone you want to talk to — on WhatsApp, LinkedIn, a mail. Opening it starts a direct message with you.'
          : `Share it with whoever should be in ${what}. Opening it puts them in the space.`}
      </Text>

      {link === null && !error ? <ActivityIndicator /> : null}
      {link ? (
        <Group footer={link.admits ?? 'Anyone with it can join.'}>
          <View style={{ padding: 14 }}>
            <Text selectable numberOfLines={2} style={{ fontFamily: 'Menlo', fontSize: 13, color: colors.label }}>{link.url}</Text>
          </View>
          <Row onPress={() => void shareInviteLink(link.url, what).catch(() => {})}>
            <Glyph icon="sf:square.and.arrow.up" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>Share link</Text>
          </Row>
          <Row onPress={() => void copy(link.url)}>
            <Glyph icon={copied ? 'sf:checkmark' : 'sf:doc.on.doc'} />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>{copied ? 'Copied' : 'Copy link'}</Text>
          </Row>
          <Row onPress={() => setQr((on) => !on)}>
            <Glyph icon="sf:qrcode" />
            <Text style={{ flex: 1, ...type.body, color: colors.label }}>{qr ? 'Hide QR code' : 'Show QR code'}</Text>
          </Row>
          {qr ? (
            <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 20 }}>
              <QrCode value={link.url} size={220} />
            </View>
          ) : null}
        </Group>
      ) : null}
      {error ? <Text selectable style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 4 }}>{error}</Text> : null}
    </ScrollView>
  );
}
