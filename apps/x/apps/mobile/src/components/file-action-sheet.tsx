import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import type { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { fileLink } from '@/lib/spaces/file-actions';
import { useColors } from '@/theme/colors';

// What you can do with a space file (2026-10-28), in the app's own sheet (the
// message long-press look, not the system action sheet): send it in the
// space's chat, copy its link, or share the link. Send and Copy confirm in
// place, then the sheet closes.

export interface SheetFile {
  assetId: string;
  name: string;
  path?: string;
}

function fileKind(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext || ext === 'md' || ext === 'markdown') return 'Document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'Image';
  if (ext === 'pdf') return 'PDF';
  return `${ext.toUpperCase()} file`;
}

export function FileActionSheet({ file, client, org, space, spaceName, onClose }: {
  file: SheetFile | null;
  client: SpacesClient;
  org: string;
  space: string;
  spaceName?: string;
  onClose: () => void;
}) {
  const colors = useColors();
  const [done, setDone] = useState<'sent' | 'copied' | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (file) setDone(null);
  }, [file]);
  if (!file) return null;

  const link = fileLink(org, space, file.assetId);
  const folder = file.path && file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null;
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

  const rows: { key: string; icon: string; label: string; doneLabel?: string; busy?: boolean; run: () => void }[] = [
    { key: 'sent', icon: 'sf:paperplane', label: spaceName ? `Send in #${spaceName}` : 'Send in chat', doneLabel: 'Sent', busy: sending, run: send },
    { key: 'copied', icon: 'sf:link', label: 'Copy link', doneLabel: 'Copied', run: copy },
    { key: 'share', icon: 'sf:square.and.arrow.up', label: 'Share…', run: share },
  ];

  return (
    <BottomSheet
      visible
      onClose={onClose}
      style={{ marginHorizontal: 12, marginBottom: 40, padding: 10, gap: 4, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10 }}>
        <Image source="sf:doc.text" style={{ width: 24, height: 24 }} contentFit="contain" tintColor={colors.secondaryLabel} />
        <View style={{ flexShrink: 1, gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: colors.label }}>{file.name}</Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: colors.secondaryLabel }}>{[fileKind(file.name), folder].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <View style={{ height: 0.5, backgroundColor: colors.separator, marginHorizontal: 10, marginBottom: 4 }} />
      {rows.map((r) => {
        const isDone = done === r.key;
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
              <Image source={isDone ? 'sf:checkmark' : r.icon} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={isDone ? colors.label : colors.secondaryLabel} />
            )}
            <Text style={{ fontSize: 16, color: colors.label, fontWeight: isDone ? '600' : '400' }}>{isDone ? r.doneLabel : r.label}</Text>
          </Pressable>
        );
      })}
    </BottomSheet>
  );
}
