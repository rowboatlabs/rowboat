import { Image } from 'expo-image';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import type { ResolveInviteResult } from '@rowboat/spaces-protocol';
import { useColors } from '@/theme/colors';

// Joining an org from the phone (Baarali, 2026-10-02): the screen said "open
// an invite link" but nothing on the phone could. Paste the link someone
// shared, see what it opens, join; the org then comes with the next listing.

/** `https://<org>/join/<token>`, the shape every invite link has (CreateInviteResult.link). */
export function parseInviteLink(raw: string): { baseUrl: string; token: string } | null {
  try {
    const url = new URL(raw.trim());
    const match = url.pathname.match(/^\/join\/([^/]+)$/);
    if (url.protocol !== 'https:' || !match?.[1]) return null;
    return { baseUrl: url.origin, token: match[1] };
  } catch {
    return null;
  }
}

type Found = { baseUrl: string; token: string; org: string; space: string; invitedBy?: string };

export function JoinWithLink() {
  const account = useSpacesAccount();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setLink('');
    setFound(null);
    setError(null);
  };

  const look = async () => {
    setBusy(true);
    setError(null);
    try {
      // Thrown, not set: the screens' errors are what the French layer translates.
      const parsed = parseInviteLink(link);
      if (!parsed) throw new Error('This is not an invite link.');
      const resolved: ResolveInviteResult = await new SpacesClient({ baseUrl: parsed.baseUrl, token: '' }).resolveInvite(parsed.token);
      if (resolved.state === 'expired') throw new Error('This invite link has expired. Ask for a new one.');
      if (resolved.state === 'revoked') throw new Error('This invite link was revoked. Ask for a new one.');
      setFound({ ...parsed, org: resolved.org.name, space: resolved.space.name, ...(resolved.invitedBy ? { invitedBy: resolved.invitedBy } : {}) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!found) return;
    setBusy(true);
    setError(null);
    try {
      await new SpacesClient({ baseUrl: found.baseUrl, token: (opts) => account.getAccessToken(opts) }).acceptInvite(found.token);
      await account.refreshOrgs();
      setBusy(false);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
      >
        <Image source="sf:link" style={{ width: 18, height: 18 }} tintColor={colors.accent} />
        <Text style={{ fontSize: 15, color: colors.accent }}>Join with a link</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.label }}>Join with a link</Text>
            <Pressable onPress={close} hitSlop={12}>
              <Text style={{ fontSize: 16, color: colors.accent }}>Cancel</Text>
            </Pressable>
          </View>
          {found ? (
            <View style={{ gap: 12 }}>
              <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>
                {found.invitedBy ? `${found.invitedBy} invites you to #${found.space} in ${found.org}.` : `You are invited to #${found.space} in ${found.org}.`}
              </Text>
              <Pressable
                disabled={busy}
                onPress={() => void join()}
                style={({ pressed }) => ({ backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: pressed || busy ? 0.7 : 1 })}
              >
                {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={{ fontSize: 16, fontWeight: '600', color: colors.onAccent }}>Join</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>Paste the invite link someone shared with you.</Text>
              <TextInput
                value={link}
                onChangeText={(text) => { setLink(text); setError(null); }}
                placeholder="https://…/join/…"
                placeholderTextColor={colors.tertiaryLabel}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                autoFocus
                editable={!busy}
                onSubmitEditing={() => void look()}
                style={{ fontSize: 16, color: colors.label, backgroundColor: colors.secondaryBackground, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 }}
              />
              <Pressable
                disabled={busy || !link.trim()}
                onPress={() => void look()}
                style={({ pressed }) => ({ backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: pressed || busy || !link.trim() ? 0.6 : 1 })}
              >
                {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={{ fontSize: 16, fontWeight: '600', color: colors.onAccent }}>Continue</Text>}
              </Pressable>
            </View>
          )}
          {error ? <Text selectable style={{ fontSize: 14, color: colors.destructive }}>{error}</Text> : null}
        </View>
      </Modal>
    </>
  );
}
