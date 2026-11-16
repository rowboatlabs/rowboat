import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { Asset } from '@rowboat/spaces-protocol';

import { Glyph, Group, Row } from '@/components/grouped';
import { friendlyError } from '@/lib/spaces/errors';
import { baseName, parentFolder } from '@/lib/spaces/file-actions';
import { useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Trash (2026-11-13, the desktop's Trash dialog): files moved to Trash keep
// their history and come back at their old path, while nobody else holds it
// (the server then says to move that file first).
export default function FileTrashScreen() {
  const colors = useColors();
  const { org, space } = useLocalSearchParams<{ org: string; space: string }>();
  const client = useOrgClient(org);
  const [entries, setEntries] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await client.listAssets(space, { includeDeleted: true });
      setEntries(all.filter((e) => e.state === 'deleted').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [client, space]);
  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (entry: Asset) => {
    setRestoring(entry.id);
    try {
      await client.restoreAsset(space, { assetId: entry.id, actingMode: 'direct' });
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (err) {
      Alert.alert(`Couldn’t restore “${baseName(entry.path)}”`, friendlyError(err));
    } finally {
      setRestoring(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Stack.Screen options={{ title: 'Trash', headerBackButtonDisplayMode: 'minimal' }} />
      {error ? <Text style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 4 }}>{error}</Text> : null}
      {entries === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {entries?.length === 0 ? (
        <Text style={{ textAlign: 'center', marginTop: 48, ...type.caption, color: colors.tertiaryLabel }}>Nothing here. Deleted files land here, restorable any time.</Text>
      ) : null}
      {entries && entries.length > 0 ? (
        <Group footer="Restoring puts a file back where it was, with its history.">
          {entries.map((e, i) => (
            <Row key={e.id} first={i === 0}>
              <Glyph icon={e.blob?.mime.startsWith('image/') ? 'sf:photo' : 'sf:doc.text'} />
              <View style={{ flex: 1, paddingVertical: 10, gap: 2 }}>
                <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>{baseName(e.path)}</Text>
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.secondaryLabel }}>
                  {[parentFolder(e.path), `deleted ${new Date(e.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Pressable
                hitSlop={8}
                disabled={restoring !== null}
                onPress={() => void restore(e)}
                style={({ pressed }) => ({ opacity: pressed || (restoring !== null && restoring !== e.id) ? 0.5 : 1 })}
              >
                {restoring === e.id ? <ActivityIndicator size="small" /> : <Text style={{ ...type.caption, fontWeight: '600', color: colors.accent }}>Restore</Text>}
              </Pressable>
            </Row>
          ))}
        </Group>
      ) : null}
    </ScrollView>
  );
}
