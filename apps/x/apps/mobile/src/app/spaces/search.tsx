import { Stack, useLocalSearchParams } from 'expo-router';
import { Image } from '@/components/sf-image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import type { SearchResults } from '@rowboat/spaces-protocol';

import { SearchHits, noHits } from '@/components/search-results';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { useColors } from '@/theme/colors';

// Search one space (server-side FTS): the native header search bar drives
// GET /v1/spaces/:id/search; message hits open their thread, file hits the
// file, discussion hits their thread. Debounced — one request per pause, not per keystroke.
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

  // Every hit is in this space (2026-11-12: discussions shown too, as the web's bar has them).
  const spaceFor = useCallback((id: string) => (id === space ? { title: title ?? '' } : undefined), [space, title]);

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
      {!busy && results && noHits(results, spaceFor) ? (
        <Text style={{ textAlign: 'center', marginTop: 48, fontSize: 14, color: colors.tertiaryLabel }}>No results for “{query.trim()}”</Text>
      ) : null}
      {results ? <SearchHits results={results} org={org} me={me} spaceFor={spaceFor} /> : null}
    </ScrollView>
  );
}

