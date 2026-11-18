import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Image } from '@/components/sf-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native';
import type { Asset } from '@rowboat/spaces-protocol';

import { BottomSheet } from '@/components/bottom-sheet';
import type { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { fileLink, filesInFolder, trashFolder } from '@/lib/spaces/file-actions';
import { useColors } from '@/theme/colors';

// What you can do with a space file (2026-10-28), in the app's own sheet (the
// message long-press look, not the system action sheet): send it in the
// space's chat, copy its link, or share the link. Send and Copy confirm in
// place, then the sheet closes.
// File management (2026-11-13, the desktop's row menu): rename or move, the
// version history, and Move to Trash. Folders get their own sheet below.

export interface SheetFile {
  assetId: string;
  name: string;
  path?: string;
  /** The version the person is looking at — what a delete is checked against. Read fresh when absent. */
  version?: number;
}

function fileKind(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext || ext === 'md' || ext === 'markdown') return 'Document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'Image';
  if (ext === 'pdf') return 'PDF';
  return `${ext.toUpperCase()} file`;
}

interface SheetRow {
  key: string;
  icon: string;
  label: string;
  doneLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  run: () => void;
}

function ActionSheet({ icon, title, subtitle, rows, done, onClose }: {
  icon: string;
  title: string;
  subtitle: string;
  rows: SheetRow[];
  done: string | null;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <BottomSheet
      visible
      onClose={onClose}
      style={{ marginHorizontal: 12, marginBottom: 40, padding: 10, gap: 4, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10 }}>
        <Image source={icon} style={{ width: 24, height: 24 }} contentFit="contain" tintColor={colors.secondaryLabel} />
        <View style={{ flexShrink: 1, gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.label }}>{title}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.secondaryLabel }}>{subtitle}</Text>
        </View>
      </View>
      <View style={{ height: 0.5, backgroundColor: colors.separator, marginHorizontal: 10, marginBottom: 4 }} />
      {rows.map((r) => {
        const isDone = done === r.key;
        const tint = r.destructive ? colors.destructive : undefined;
        return (
          <Pressable
            key={r.key}
            disabled={done !== null || r.busy}
            onPress={() => {
              if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
              r.run();
            }}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46,
              paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous',
              backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
            })}
          >
            {r.busy ? (
              <ActivityIndicator size="small" style={{ width: 20 }} />
            ) : (
              <Image source={isDone ? 'sf:checkmark' : r.icon} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={tint ?? (isDone ? colors.label : colors.secondaryLabel)} />
            )}
            <Text style={{ fontSize: 16, color: tint ?? colors.label, fontWeight: isDone ? '600' : '400' }}>{isDone ? r.doneLabel : r.label}</Text>
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}

/** Push a screen once the sheet has slid away (a modal mid-dismiss swallows the push). */
function afterSheet(onClose: () => void, then: () => void) {
  onClose();
  setTimeout(then, 300);
}

export function FileActionSheet({ file, client, org, space, spaceName, onClose, onDeleted }: {
  file: SheetFile | null;
  client: SpacesClient;
  org: string;
  space: string;
  spaceName?: string;
  onClose: () => void;
  /** The file went to Trash — the owner refreshes or leaves. */
  onDeleted?: () => void;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (file) setDone(null);
  }, [file]);
  if (!file) return null;

  const link = fileLink(org, space, file.assetId);
  const path = file.path ?? file.name;
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
  const confirm = (what: 'sent' | 'copied') => {
    setDone(what);
    if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(onClose, 650);
  };

  const send = () => {
    if (sending) return;
    setSending(true);
    client
      .postMessage(space, { body: `[${file.name.replace(/[[\]]/g, '')}](${link})`, actingMode: 'direct' })
      .then(() => confirm('sent'))
      .catch((err) => Alert.alert('Couldn’t send the file', friendlyError(err)))
      .finally(() => setSending(false));
  };
  const copy = () => {
    void Clipboard.setStringAsync(link);
    confirm('copied');
  };
  const share = () => {
    onClose();
    // After the sheet's slide-out: the system share sheet can't present over a dismissing modal.
    setTimeout(() => void Share.share({ url: link, message: process.env.EXPO_OS === 'ios' ? undefined : link, title: file.name }).catch(() => {}), 350);
  };
  const move = () =>
    afterSheet(onClose, () => router.push({ pathname: '/spaces/file-move', params: { org, space, assetId: file.assetId, path } }));
  const history = () =>
    afterSheet(onClose, () => router.push({ pathname: '/spaces/file-history', params: { org, space, assetId: file.assetId, path } }));
  // Delete is Trash, as on the desktop: nothing is destroyed, and Trash
  // (the Files screen's header) brings it back.
  const trash = () =>
    Alert.alert(`Move “${file.name}” to Trash?`, 'This removes the file from the space’s files for everyone. You can restore it from Trash.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          void (async () => {
            try {
              const baseVersion = file.version ?? (await client.readAsset(space, file.assetId)).version;
              const res = await client.deleteAsset(space, { assetId: file.assetId, baseVersion, actingMode: 'direct' });
              if (res.outcome === 'conflict') {
                Alert.alert('The file changed meanwhile', 'Someone edited it while you were deciding. Look at the latest version, then try again.');
                return;
              }
              if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onClose();
              onDeleted?.();
            } catch (err) {
              Alert.alert('Couldn’t delete the file', friendlyError(err));
            } finally {
              setDeleting(false);
            }
          })();
        },
      },
    ]);

  const rows: SheetRow[] = [
    { key: 'sent', icon: 'sf:paperplane', label: spaceName ? `Send in #${spaceName}` : 'Send in chat', doneLabel: 'Sent', busy: sending, run: send },
    { key: 'copied', icon: 'sf:link', label: 'Copy link', doneLabel: 'Copied', run: copy },
    { key: 'share', icon: 'sf:square.and.arrow.up', label: 'Share…', run: share },
    { key: 'move', icon: 'sf:pencil', label: 'Rename or move', run: move },
    { key: 'history', icon: 'sf:clock.arrow.circlepath', label: 'Version history', run: history },
    { key: 'trash', icon: 'sf:trash', label: 'Move to Trash', destructive: true, busy: deleting, run: trash },
  ];

  return <ActionSheet icon="sf:doc.text" title={file.name} subtitle={[fileKind(file.name), folder].filter(Boolean).join(' · ')} rows={rows} done={done} onClose={onClose} />;
}

// A folder is only the files whose paths start with it (2026-11-13): renaming
// one moves each file, and Trash takes each file. The desktop has no folder
// menu beyond removing an empty draft folder; on the phone a long-press is the
// only way to reach these, so the folder gets the same two actions files have.
export function FolderActionSheet({ folder, entries, client, org, space, onClose, onChanged }: {
  folder: string | null;
  entries: Asset[];
  client: SpacesClient;
  org: string;
  space: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  if (folder === null) return null;
  const name = folder.split('/').pop() ?? folder;
  const count = filesInFolder(entries, folder).length;
  const files = count === 1 ? '1 file' : `${count} files`;

  const move = () => afterSheet(onClose, () => router.push({ pathname: '/spaces/file-move', params: { org, space, folder } }));
  const trash = () =>
    Alert.alert(`Move “${name}” to Trash?`, `Its ${files} leave the space’s files for everyone. You can restore each from Trash.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Move to Trash',
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          void trashFolder(client, space, entries, folder)
            .then(({ failed }) => {
              if (failed) Alert.alert(`${failed === 1 ? '1 file' : `${failed} files`} stayed`, 'They changed meanwhile or couldn’t be deleted. Try again from the folder.');
              onClose();
              onChanged();
            })
            .finally(() => setDeleting(false));
        },
      },
    ]);

  const rows: SheetRow[] = [
    { key: 'move', icon: 'sf:pencil', label: 'Rename or move', run: move },
    { key: 'trash', icon: 'sf:trash', label: 'Move to Trash', destructive: true, busy: deleting, run: trash },
  ];
  return <ActionSheet icon="sf:folder" title={name} subtitle={[files, folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : null].filter(Boolean).join(' · ')} rows={rows} done={null} onClose={onClose} />;
}
