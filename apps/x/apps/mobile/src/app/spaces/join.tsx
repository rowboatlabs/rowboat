import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { ResolveInviteResult } from '@rowboat/spaces-protocol';

import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { useColors } from '@/theme/colors';

// Join a space from an invite link (https://<org>/join/<token>): paste or
// arrive by link → resolve (pre-auth) → "Join #space in Org" → sign in if
// needed (tokens are realm-generic, one sign-in covers every org) → accept →
// the space opens. Mirrors core/spaces/oauth.ts joinViaInviteLink.

export function parseInviteLink(url: string): { baseUrl: string; token: string } | null {
  try {
    const u = new URL(url.trim());
    const match = u.pathname.match(/^\/join\/([^/]+)$/);
    if (!match?.[1]) return null;
    return { baseUrl: u.origin, token: match[1] };
  } catch {
    return null;
  }
}

export default function JoinScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ url?: string }>();
  const [url, setUrl] = useState(params.url ?? '');
  const [resolved, setResolved] = useState<(ResolveInviteResult & { baseUrl: string; token: string }) | null>(null);
  const [busy, setBusy] = useState<'resolving' | 'joining' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async (raw: string) => {
    const parsed = parseInviteLink(raw);
    if (!parsed) {
      setError('That is not an invite link — it should look like https://team.spaces.x.rowboatlabs.com/join/…');
      return;
    }
    setBusy('resolving');
    setError(null);
    try {
      const client = new SpacesClient({ baseUrl: parsed.baseUrl, token: '' });
      setResolved({ ...(await client.resolveInvite(parsed.token)), ...parsed });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, []);

  // Arrived by link: resolve straight away.
  useEffect(() => {
    if (!params.url) return;
    setUrl(params.url);
    void resolve(params.url);
  }, [params.url, resolve]);

  const join = async () => {
    if (!resolved || resolved.state !== 'ok') return;
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    setBusy('joining');
    setError(null);
    try {
      if (account.status !== 'signedIn') await account.signIn();
      const client = new SpacesClient({ baseUrl: resolved.baseUrl, token: (o) => account.getAccessToken(o) });
      const result = await client.acceptInvite(resolved.token);
      await account.refreshOrgs();
      const org = new URL(resolved.baseUrl).host;
      const me = await client.me();
      router.replace('/spaces');
      router.push({ pathname: '/spaces/chat', params: { org, space: result.space.id, title: result.space.name, me: me.member.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      <Stack.Screen options={{ title: 'Join a space' }} />
      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.secondaryLabel }}>
        Paste the invite link a teammate shared with you.
      </Text>
      <TextInput
        value={url}
        onChangeText={(t) => {
          setUrl(t);
          setResolved(null);
        }}
        placeholder="https://team.spaces.x.rowboatlabs.com/join/…"
        placeholderTextColor={colors.tertiaryLabel}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => void resolve(url)}
        style={{
          fontSize: 15, color: colors.label, paddingHorizontal: 14, paddingVertical: 12,
          borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.secondaryBackground,
        }}
      />
      {!resolved ? (
        <Pressable
          disabled={!url.trim() || busy !== null}
          onPress={() => void resolve(url)}
          style={({ pressed }) => ({
            paddingVertical: 13, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center',
            backgroundColor: colors.label, opacity: !url.trim() || busy || pressed ? 0.6 : 1,
          })}
        >
          {busy === 'resolving' ? <ActivityIndicator color={colors.background} /> : <Text style={{ fontSize: 15, fontWeight: '600', color: colors.background }}>Continue</Text>}
        </Pressable>
      ) : resolved.state === 'ok' ? (
        <View style={{ gap: 14, padding: 16, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.secondaryBackground }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.separator }}>
              <Image source="sf:number" style={{ width: 20, height: 20 }} tintColor={colors.label} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>{resolved.space.name}</Text>
              <Text style={{ fontSize: 13, color: colors.secondaryLabel }}>
                {resolved.org.name}{resolved.invitedBy ? ` · invited by ${resolved.invitedBy}` : ''}
              </Text>
            </View>
          </View>
          <Pressable
            disabled={busy !== null}
            onPress={() => void join()}
            style={({ pressed }) => ({
              paddingVertical: 13, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center',
              backgroundColor: colors.label, opacity: busy || pressed ? 0.6 : 1,
            })}
          >
            {busy === 'joining' ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.background }}>
                {account.status === 'signedIn' ? 'Join space' : 'Sign in and join'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : (
        <Text style={{ fontSize: 14, color: colors.destructive }}>
          This invite link has {resolved.state === 'expired' ? 'expired' : 'been revoked'}. Ask for a new one.
        </Text>
      )}
      {error ? <Text selectable style={{ fontSize: 13, color: colors.destructive }}>{error}</Text> : null}
    </ScrollView>
  );
}
