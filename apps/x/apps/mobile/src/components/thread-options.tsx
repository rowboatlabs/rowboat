import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from '@/components/sf-image';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Asset, Message, Topic } from '@rowboat/spaces-protocol';

import { BottomSheet } from '@/components/bottom-sheet';
import type { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { archiveLabel, threadLabelOf, withArchived } from '@/lib/spaces/threads';
import { useColors } from '@/theme/colors';
import { type } from '@/theme/type';

// A thread's options (2026-11-13, the web thread pane's ⋯ menu): copy its
// link; a discussion renames, links or unlinks its one file, archives, or
// converts back to a plain thread; any other thread becomes a session or a
// discussion, and archives. A session renames, ends (archiving it), reopens,
// or becomes a plain thread. One sheet whose page changes in place: the menu,
// a title field, or the space's files to link. Opened from the thread
// screen's header and by long-pressing a row in the threads lists.

type Page = { kind: 'menu' } | { kind: 'title'; for: 'discussion' | 'session' | 'rename-discussion'; initial: string } | { kind: 'files' };

export interface ThreadChange {
  root?: Message;
  /** null: the discussion was converted back to a plain thread. */
  topic?: Topic | null;
}

export function ThreadOptionsSheet({ visible, onClose, client, org, space, root, topic, onChange }: {
  visible: boolean;
  onClose: () => void;
  client: SpacesClient;
  org: string;
  space: string;
  root: Message | null;
  topic: Topic | null;
  onChange: (change: ThreadChange) => void;
}) {
  const colors = useColors();
  const [page, setPage] = useState<Page>({ kind: 'menu' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible) setPage({ kind: 'menu' });
  }, [visible]);
  if (!root) return null;
  const session = topic ? undefined : root.session;

  /** One server change; the sheet closes once it lands, or says why it didn't. */
  const run = async (work: () => Promise<ThreadChange>, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await work());
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      Alert.alert(failure, friendlyError(err, "You're offline. Try again when you're back online."));
    } finally {
      setBusy(false);
    }
  };
  const manage = (action: Parameters<SpacesClient['manageTopic']>[2], failure = 'Couldn’t update the discussion') =>
    topic &&
    run(async () => {
      const next = await client.manageTopic(space, topic.id, action);
      return { topic: action.action === 'remove' ? null : next };
    }, failure);
  const archiveThread = (archived: boolean) =>
    run(async () => ({ root: await client.archiveThread(space, root.id, archived) }), root.session ? 'Couldn’t change the session' : 'Couldn’t archive the thread');
  const setSession = (title: string | null) =>
    run(async () => ({ root: await client.setSession(space, root.id, title === null ? null : { title }) }), 'Couldn’t update the session');
  const createTopic = (title: string) =>
    run(async () => {
      const res = await client.createTopic(space, { rootMessageId: root.id, title, actingMode: 'direct' });
      // Naming unarchives an archived root on the server (2026-11-03).
      return { topic: res.topic, root: root.archived ? withArchived(root, false) : root };
    }, 'Couldn’t make the discussion');

  const submitTitle = (p: Extract<Page, { kind: 'title' }>, value: string) => {
    const title = value.trim();
    if (!title) return;
    if (p.for === 'session') {
      if (title === root.session?.title) onClose();
      else void setSession(title);
    } else if (p.for === 'rename-discussion') {
      if (title === topic?.title) onClose();
      else void manage({ action: 'retitle', title, actingMode: 'direct' });
    } else void createTopic(title);
  };

  const copyLink = () => {
    void Clipboard.setStringAsync(`https://${org}/s/${space}/m/${root.id}`);
    if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  };

  const rows: { key: string; icon: string; label: string; run: () => void }[] = [{ key: 'link', icon: 'sf:link', label: 'Copy link', run: copyLink }];
  if (topic) {
    rows.push(
      { key: 'rename', icon: 'sf:pencil', label: 'Rename', run: () => setPage({ kind: 'title', for: 'rename-discussion', initial: topic.title }) },
      { key: 'file', icon: 'sf:paperclip', label: topic.documentAssetId ? 'Change linked file' : 'Link a file', run: () => setPage({ kind: 'files' }) },
    );
    if (topic.documentAssetId) rows.push({ key: 'unlink', icon: 'sf:minus.circle', label: 'Unlink file', run: () => void manage({ action: 'detach_document', actingMode: 'direct' }) });
    rows.push(
      topic.archived
        ? { key: 'unarchive', icon: 'sf:archivebox.fill', label: 'Unarchive', run: () => void manage({ action: 'unarchive', actingMode: 'direct' }) }
        : { key: 'archive', icon: 'sf:archivebox', label: 'Archive', run: () => void manage({ action: 'archive', actingMode: 'direct' }) },
      { key: 'remove', icon: 'sf:text.bubble', label: 'Convert back to thread', run: () => void manage({ action: 'remove', actingMode: 'direct' }) },
    );
  } else {
    if (session) {
      rows.push(
        { key: 'rename', icon: 'sf:pencil', label: 'Rename session', run: () => setPage({ kind: 'title', for: 'session', initial: session.title }) },
        { key: 'plain', icon: 'sf:text.bubble', label: 'Make it a plain thread', run: () => void setSession(null) },
      );
    } else {
      rows.push(
        { key: 'session', icon: 'sf:timer', label: 'Make this a session', run: () => setPage({ kind: 'title', for: 'session', initial: threadLabelOf(root.body) }) },
        { key: 'discussion', icon: 'sf:tag', label: 'Make this a discussion', run: () => setPage({ kind: 'title', for: 'discussion', initial: '' }) },
      );
    }
    rows.push({
      key: 'archive',
      icon: root.archived ? 'sf:archivebox.fill' : session ? 'sf:checkmark.circle' : 'sf:archivebox',
      label: archiveLabel(root),
      run: () => void archiveThread(!root.archived),
    });
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      style={{ marginHorizontal: 12, marginBottom: 40, padding: 10, gap: 4, borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background }}
    >
      {page.kind === 'menu' ? (
        <>
          <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10, gap: 1 }}>
            <Text style={{ ...type.caption, color: colors.secondaryLabel }}>{topic ? 'Discussion' : session ? (root.archived ? 'Session, ended' : 'Session') : 'Thread'}</Text>
            <Text numberOfLines={2} style={{ fontSize: 16, fontWeight: '600', color: colors.label }}>
              {topic?.title ?? session?.title ?? threadLabelOf(root.body)}
            </Text>
          </View>
          <View style={{ height: 0.5, backgroundColor: colors.separator, marginHorizontal: 10, marginBottom: 4 }} />
          {rows.map((r) => (
            <SheetRow key={r.key} icon={r.icon} label={r.label} disabled={busy} onPress={r.run} />
          ))}
          {busy ? <ActivityIndicator style={{ position: 'absolute', top: 16, right: 18 }} /> : null}
        </>
      ) : page.kind === 'title' ? (
        <TitlePage
          heading={page.for === 'session' ? (session ? 'Rename session' : 'Make this a session') : page.for === 'rename-discussion' ? 'Rename discussion' : 'Make this a discussion'}
          placeholder={page.for === 'session' ? 'Session title' : 'What needs to get resolved?'}
          maxLength={page.for === 'session' ? 200 : 256}
          initial={page.initial}
          busy={busy}
          onCancel={() => setPage({ kind: 'menu' })}
          onSubmit={(value) => submitTitle(page, value)}
        />
      ) : (
        <FilesPage
          client={client}
          space={space}
          current={topic?.documentAssetId}
          busy={busy}
          onCancel={() => setPage({ kind: 'menu' })}
          onPick={(assetId) => {
            if (assetId === topic?.documentAssetId) onClose();
            else void manage({ action: 'attach_document', assetId, actingMode: 'direct' }, 'Couldn’t link the file');
          }}
        />
      )}
    </BottomSheet>
  );
}

function SheetRow({ icon, label, disabled, onPress, trailing }: { icon: string; label: string; disabled?: boolean; onPress: () => void; trailing?: ReactNode }) {
  const colors = useColors();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46,
        paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous',
        backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Image source={icon} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={colors.secondaryLabel} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.label }}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

/** Lifts its page over the keyboard: the sheet is a modal, outside the screen's keyboard handling. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const ios = process.env.EXPO_OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

function TitlePage({ heading, placeholder, maxLength, initial, busy, onCancel, onSubmit }: {
  heading: string;
  placeholder: string;
  maxLength: number;
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const colors = useColors();
  const [value, setValue] = useState(initial);
  const keyboard = useKeyboardHeight();
  // The sheet already sits 40pt above the screen's foot.
  const lift = Math.max(0, keyboard - 30);
  return (
    <View style={{ gap: 12, padding: 6, marginBottom: lift }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={{ ...type.body, color: colors.secondaryLabel }}>Back</Text>
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', ...type.bodyStrong, color: colors.label }}>{heading}</Text>
        <Pressable onPress={() => onSubmit(value)} disabled={busy || !value.trim()} hitSlop={10}>
          <Text style={{ ...type.bodyStrong, color: colors.label, opacity: busy || !value.trim() ? 0.4 : 1 }}>{busy ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
      <TextInput
        autoFocus
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        maxLength={maxLength}
        returnKeyType="done"
        selectTextOnFocus
        onSubmitEditing={() => onSubmit(value)}
        style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderCurve: 'continuous', backgroundColor: colors.secondaryBackground, ...type.body, color: colors.label }}
      />
    </View>
  );
}

/** The space's live files; the discussion keeps the link by id, so it survives renames. */
function FilesPage({ client, space, current, busy, onCancel, onPick }: {
  client: SpacesClient;
  space: string;
  current?: string;
  busy: boolean;
  onCancel: () => void;
  onPick: (assetId: string) => void;
}) {
  const colors = useColors();
  const [files, setFiles] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    client
      .listAssets(space)
      .then((list) => !cancelled && setFiles([...list].sort((a, b) => a.path.localeCompare(b.path))))
      .catch((err) => !cancelled && setError(friendlyError(err, "You're offline. Files will load when you're back online.")));
    return () => {
      cancelled = true;
    };
  }, [client, space]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 6, paddingBottom: 8 }}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={{ ...type.body, color: colors.secondaryLabel }}>Back</Text>
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', ...type.bodyStrong, color: colors.label }}>Link a file</Text>
        <View style={{ width: 40 }}>{busy ? <ActivityIndicator size="small" /> : null}</View>
      </View>
      {error ? <Text style={{ ...type.caption, color: colors.secondaryLabel, padding: 12 }}>{error}</Text> : null}
      {files === null && !error ? <ActivityIndicator style={{ marginVertical: 24 }} /> : null}
      {files?.length === 0 ? (
        <Text style={{ ...type.caption, color: colors.secondaryLabel, padding: 12 }}>This space has no files yet.</Text>
      ) : null}
      {files ? (
        <ScrollView style={{ maxHeight: 360 }}>
          {files.map((f) => (
            <SheetRow
              key={f.id}
              icon="sf:doc.text"
              label={f.path}
              disabled={busy}
              onPress={() => onPick(f.id)}
              trailing={f.id === current ? <Image source="sf:checkmark" style={{ width: 16, height: 16 }} tintColor={colors.label} /> : null}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
