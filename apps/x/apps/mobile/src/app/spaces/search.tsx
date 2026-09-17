import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { SearchResults } from '@rowboat/spaces-protocol';

import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { useColors } from '@/theme/colors';

// Search one space (server-side FTS): the native header search bar drives
// GET /v1/spaces/:id/search; message hits open their thread, file hits the
// file. Debounced — one request per pause, not per keystroke.
export default function SpaceSearchScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; title: string; me: string }>();
  const { org, space, title, me } = params;
  const client = useMemo(() => new SpacesClient({ baseUrl: `https://${org}`, token: (o) => account.getAccessToken(o) }), [org, account]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      client
        .search(space, { q, limit: 30 })
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setBusy(false));
    }, 300);
    return () => clearTimeout(t);
  }, [client, space, query]);

  const base = { org, space, title, me };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingVertical: 8 }}
    >
      <Stack.Screen options={{ title: 'Search' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.secondaryBackground }}>
        <Image source="sf:magnifyingglass" style={{ width: 16, height: 16 }} tintColor={colors.tertiaryLabel} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder={`Search #${title ?? ''}`}
          placeholderTextColor={colors.tertiaryLabel}
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ flex: 1, paddingVertical: 10, fontSize: 16, color: colors.label }}
        />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {error ? <Text selectable style={{ fontSize: 13, color: colors.destructive, paddingHorizontal: 16 }}>{error}</Text> : null}
      {!busy && results && results.messages.length === 0 && results.assets.length === 0 ? (
        <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>No results for “{query.trim()}”</Text>
      ) : null}

      {results?.messages.length ? <Section label="Messages" /> : null}
      {results?.messages.map((hit) => (
        <Pressable
          key={hit.messageId}
          onPress={() => router.push({ pathname: '/spaces/thread', params: { ...base, root: hit.threadRootId } })}
          style={({ pressed }) => ({
            marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 10, gap: 2, borderRadius: 10, borderCurve: 'continuous',
            backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
          })}
        >
          <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>
            {hit.topicTitle ? `${hit.topicTitle} · ` : ''}{new Date(hit.postedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </Text>
          <Text numberOfLines={3} style={{ fontSize: 15, lineHeight: 20, color: colors.label }}>{hit.snippet}</Text>
        </Pressable>
      ))}

      {results?.assets.length ? <Section label="Files" /> : null}
      {results?.assets.map((hit) => (
        <Pressable
          key={hit.path}
          onPress={() => router.push({ pathname: '/spaces/file', params: { org, space, path: hit.path, title: hit.path.split('/').pop() ?? hit.path } })}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 10,
            borderRadius: 10, borderCurve: 'continuous', backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
          })}
        >
          <Image source="sf:doc.text" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, color: colors.label }}>{hit.path}</Text>
            {hit.snippet ? <Text numberOfLines={2} style={{ fontSize: 13, color: colors.secondaryLabel }}>{hit.snippet}</Text> : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Section({ label }: { label: string }) {
  const colors = useColors();
  return <Text style={{ fontSize: 13, fontWeight: '600', color: colors.secondaryLabel, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>{label}</Text>;
}
