import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { Asset } from '@rowboat/spaces-protocol';

import { Glyph, Group, PrimaryButton, Row, Tick } from '@/components/grouped';
import { friendlyError } from '@/lib/spaces/errors';
import { baseName, folderPaths, joinPath, moveFolder, parentFolder } from '@/lib/spaces/file-actions';
import { useOrgClient } from '@/lib/spaces/invites';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// Rename or move a file or a folder (2026-11-13). The desktop edits the full
// path inline; on the phone the path is split into a name and a folder, and
// the space's folders are listed to tap. A file keeps its id, so links and
// open screens keep working. A folder is a path prefix: every file in it moves.
export default function FileMoveScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ org: string; space: string; assetId?: string; path?: string; folder?: string }>();
  const { org, space, assetId } = params;
  const client = useOrgClient(org);
  const isFolder = !assetId && !!params.folder;
  const from = (isFolder ? params.folder : params.path) ?? '';

  const [entries, setEntries] = useState<Asset[] | null>(null);
  const [name, setName] = useState(baseName(from));
  const [folder, setFolder] = useState(parentFolder(from));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await client.listAssets(space));
    } catch (err) {
      Alert.alert('Couldn’t load the files', friendlyError(err));
      setEntries([]);
    }
  }, [client, space]);
  useEffect(() => {
    void load();
  }, [load]);

  // A folder can't move inside itself.
  const folders = useMemo(
    () => folderPaths(entries ?? []).filter((f) => !isFolder || (f !== from && !f.startsWith(`${from}/`))),
    [entries, isFolder, from],
  );
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, '');
  const cleanName = name.trim().replace(/\//g, '');
  const toPath = cleanName ? joinPath(cleanFolder, cleanName) : '';
  const unchanged = toPath === from;
  const intoItself = isFolder && (cleanFolder === from || cleanFolder.startsWith(`${from}/`));

  const save = async () => {
    if (!toPath || unchanged || intoItself || busy) return;
    setBusy(true);
    try {
      if (isFolder) {
        const { moved, failed } = await moveFolder(client, space, entries ?? [], from, toPath);
        if (failed) {
          Alert.alert(`${failed === 1 ? '1 file' : `${failed} files`} stayed in “${baseName(from)}”`, `${moved} moved. The rest changed meanwhile, or a file already has their new name.`);
          await load();
          return;
        }
      } else {
        const entry = entries?.find((e) => e.id === assetId);
        const baseVersion = entry?.version ?? (await client.readAsset(space, assetId!)).version;
        const res = await client.moveAsset(space, { assetId: assetId!, toPath, baseVersion, actingMode: 'direct' });
        if (res.outcome === 'conflict') {
          Alert.alert('The file changed meanwhile', 'Someone edited it while you were renaming. Try again.');
          await load();
          return;
        }
      }
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (err) {
      // An occupied path comes back as the server's own words.
      Alert.alert(isFolder ? 'Couldn’t move the folder' : 'Couldn’t move the file', friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (value: string, onChange: (v: string) => void, placeholder: string, autoFocus?: boolean) => (
    <View style={{ paddingHorizontal: 14, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.card }}>
      <TextInput
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        style={{ paddingVertical: 13, ...type.body, color: colors.label }}
      />
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.groupedBackground }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }}
    >
      <Stack.Screen options={{ title: isFolder ? 'Rename folder' : 'Rename or move', headerBackButtonDisplayMode: 'minimal' }} />
      <View style={{ gap: 6 }}>
        <Text style={{ ...type.section, color: colors.secondaryLabel, paddingHorizontal: 16 }}>Name</Text>
        {field(name, setName, isFolder ? 'Folder name' : 'File name', true)}
      </View>
      <View style={{ gap: 6 }}>
        <Text style={{ ...type.section, color: colors.secondaryLabel, paddingHorizontal: 16 }}>In folder</Text>
        {field(folder, setFolder, 'Top level — or type a new folder')}
      </View>
      {entries === null ? (
        <ActivityIndicator />
      ) : (
        <Group label="Folders">
          <Row first onPress={() => setFolder('')}>
            <Glyph icon="sf:folder" />
            <Text style={{ ...type.body, flex: 1, color: colors.label }}>Top level</Text>
            <Tick on={cleanFolder === ''} />
          </Row>
          {folders.map((f) => (
            <Row key={f} onPress={() => setFolder(f)}>
              <Glyph icon="sf:folder" />
              <Text numberOfLines={1} style={{ ...type.body, flex: 1, color: colors.label }}>{f}</Text>
              <Tick on={cleanFolder === f} />
            </Row>
          ))}
        </Group>
      )}
      {intoItself ? <Text style={{ ...type.caption, color: colors.destructive, paddingHorizontal: 4 }}>A folder can’t move inside itself.</Text> : null}
      <PrimaryButton
        label={busy ? 'Saving' : isFolder ? 'Move folder' : 'Save'}
        busy={busy}
        disabled={!toPath || unchanged || intoItself || entries === null}
        onPress={() => void save()}
      />
    </ScrollView>
  );
}
