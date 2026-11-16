import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import type { ChangeSet, Member } from '@rowboat/spaces-protocol';
import { SpacesLive } from '@x/spaces-client';

import { Avatar } from '@/components/avatar';
import { BottomSheet } from '@/components/bottom-sheet';
import { Group, PrimaryButton, Row } from '@/components/grouped';
import { Image } from '@/components/sf-image';
import { useSpacesAccount } from '@/lib/spaces/account';
import { reportMobileActivity } from '@/lib/spaces/activity';
import { friendlyError } from '@/lib/spaces/errors';
import { attributionLabel, baseName, isRestorableChangeSet, restoreVersion } from '@/lib/spaces/file-actions';
import { useOrgClient } from '@/lib/spaces/invites';
import { useProfiles } from '@/lib/spaces/profiles';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// A file's version history (2026-11-13, the desktop's History panel): who
// changed it, when, and why, newest first. Tapping an edit shows what it
// changed; an edit older than the current version can be restored. Restoring
// saves the old content as a new version, so nothing in between is lost.
export default function FileHistoryScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; assetId: string; path?: string }>();
  const { org, space, assetId } = params;
  const client = useOrgClient(org);

  const [changeSets, setChangeSets] = useState<ChangeSet[] | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [path, setPath] = useState(params.path ?? '');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [roster, setRoster] = useState<Map<string, Member>>(() => new Map());
  const profiles = useProfiles(client, roster);
  const names = useMemo(() => new Map([...profiles].map(([id, m]) => [id, m.displayName])), [profiles]);
  const [diff, setDiff] = useState<{ from: number; to: number; unified: string | null; restorable: number | null } | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [asset, history] = await Promise.all([client.readAsset(space, assetId), client.assetHistory(space, { assetId, limit: 100 })]);
      setHead(asset.version);
      setPath(asset.path);
      setChangeSets(history);
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, [client, space, assetId]);

  useEffect(() => {
    void load();
    client.listMembers(space).then((list) => setRoster(new Map(list.map((m) => [m.id, m])))).catch(() => {});
  }, [load, client, space]);

  // A change to this file (an edit, a rename, someone else's restore) adds a row.
  useEffect(() => {
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const stopActivity = reportMobileActivity(live);
    const off = live.subscribe(space, (frame) => {
      if (frame.kind === 'event' && frame.event.type === 'change' && frame.event.changeSet.assetId === assetId) void load();
    });
    return () => {
      off();
      stopActivity();
      live.close();
    };
  }, [load, account, org, space, assetId]);

  const showDiff = (cs: ChangeSet) => {
    if (cs.op) return; // a move/delete/restore changes no content
    const restorable = head !== null && isRestorableChangeSet(cs, head) ? cs.resultVersion : null;
    setDiff({ from: cs.baseVersion, to: cs.resultVersion, unified: null, restorable });
    client
      .diff(space, assetId, cs.baseVersion, cs.resultVersion)
      .then((unified) => setDiff((d) => (d && d.to === cs.resultVersion ? { ...d, unified } : d)))
      .catch((err) => {
        setDiff(null);
        Alert.alert('Couldn’t load the changes', friendlyError(err));
      });
  };

  const restore = (version: number) => {
    const current = head ?? version + 1;
    Alert.alert(
      `Restore “${baseName(path)}” to v${version}?`,
      `This saves v${version}’s content as v${current + 1} for everyone in the space. Nothing is lost: v${current} stays in history, so you can come back to it the same way.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: `Restore v${version}`,
          onPress: () => {
            setRestoring(version);
            void restoreVersion(client, space, assetId, version)
              .then((result) => {
                if (result.outcome === 'conflict') {
                  Alert.alert('The file changed while restoring', `It’s now v${result.currentVersion}. Try again.`);
                  return;
                }
                setDiff(null);
                if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              })
              .catch((err) => Alert.alert('Couldn’t restore', friendlyError(err)))
              .finally(() => {
                setRestoring(null);
                void load();
              });
          },
        },
      ],
    );
  };

  const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

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
      <Stack.Screen options={{ title: 'History', headerBackButtonDisplayMode: 'minimal' }} />
      {error ? <Text style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 4 }}>{error}</Text> : null}
      {changeSets === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {changeSets !== null ? (
        <Group label={baseName(path)} footer={changeSets.length === 0 ? 'No history yet.' : 'Tap an edit to see what it changed.'}>
          {changeSets.map((cs, i) => {
            const restorable = head !== null && isRestorableChangeSet(cs, head);
            const name = attributionLabel(cs.attribution, names);
            const what = cs.op === 'move' ? `Moved from ${cs.movedFrom ?? '…'}` : cs.op === 'delete' ? 'Deleted' : cs.op === 'restore' ? 'Restored from Trash' : null;
            return (
              <Row key={cs.id} first={i === 0} onPress={cs.op ? undefined : () => showDiff(cs)}>
                <Avatar id={cs.attribution.memberId} name={names.get(cs.attribution.memberId) ?? cs.attribution.memberId} size={28} url={profiles.get(cs.attribution.memberId)?.avatarUrl} />
                <View style={{ flex: 1, paddingVertical: 10, gap: 2 }}>
                  <Text numberOfLines={1} style={{ ...type.bodyStrong, color: colors.label }}>{name}</Text>
                  {what ? <Text numberOfLines={2} style={{ ...type.caption, color: colors.secondaryLabel }}>{what}</Text> : null}
                  {cs.reason ? <Text numberOfLines={3} style={{ ...type.caption, color: colors.secondaryLabel }}>“{cs.reason}”</Text> : null}
                  <Text style={{ ...type.caption, color: colors.tertiaryLabel }}>
                    {stamp(cs.committedAt)} · v{cs.resultVersion}{cs.resultVersion === head && !cs.op ? ' · current' : ''}
                  </Text>
                </View>
                {restorable ? (
                  <Pressable
                    hitSlop={8}
                    disabled={restoring !== null}
                    accessibilityLabel={`Restore to v${cs.resultVersion}`}
                    onPress={() => restore(cs.resultVersion)}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, opacity: pressed || restoring !== null ? 0.5 : 1 })}
                  >
                    {restoring === cs.resultVersion ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Image source="sf:arrow.uturn.backward" style={{ width: 13, height: 13 }} tintColor={colors.accent} />
                    )}
                    <Text style={{ ...type.caption, fontWeight: '600', color: colors.accent }}>Restore</Text>
                  </Pressable>
                ) : null}
              </Row>
            );
          })}
        </Group>
      ) : null}
      <BottomSheet
        visible={diff !== null}
        onClose={() => setDiff(null)}
        style={{ marginHorizontal: 12, marginBottom: 40, padding: 16, gap: 12, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background }}
      >
        <Text style={{ ...type.bodyStrong, color: colors.label }}>{diff ? `v${diff.from} → v${diff.to}` : ''}</Text>
        {diff?.unified == null ? (
          <ActivityIndicator style={{ marginVertical: 24 }} />
        ) : (
          <ScrollView style={{ maxHeight: 420, borderRadius: 10, backgroundColor: colors.secondaryBackground }} contentContainerStyle={{ padding: 10 }}>
            {diffLines(diff.unified).map((line, i) => (
              <Text
                key={i}
                selectable
                style={{
                  fontFamily: mono, fontSize: 12, lineHeight: 17,
                  color: line.startsWith('+') ? '#2f9e44' : line.startsWith('-') ? colors.destructive : line.startsWith('@@') ? colors.tertiaryLabel : colors.label,
                }}
              >
                {line || ' '}
              </Text>
            ))}
          </ScrollView>
        )}
        {/* Reading a change is usually how someone decides to go back, so the action sits here too. */}
        {diff?.restorable != null ? (
          <PrimaryButton label={`Restore to v${diff.restorable}`} busy={restoring !== null} onPress={() => restore(diff.restorable!)} />
        ) : null}
      </BottomSheet>
    </ScrollView>
  );
}

/** The unified diff minus its file header lines, which name the same file twice. */
function diffLines(unified: string): string[] {
  const lines = unified.replace(/\n$/, '').split('\n').filter((l) => !l.startsWith('--- ') && !l.startsWith('+++ '));
  return lines.length ? lines : ['No changes to the text.'];
}

function stamp(iso: string): string {
  const at = new Date(iso);
  const today = at.toDateString() === new Date().toDateString();
  return `${today ? 'Today' : at.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
