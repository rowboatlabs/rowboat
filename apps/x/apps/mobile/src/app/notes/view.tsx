import { Stack, router, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as analytics from '@/lib/analytics';
import { ChatMarkdown } from '@/components/markdown';
import { useConnection } from '@/lib/connection';
import { NOTE_LINK, noteToRenderable, splitFrontmatter } from '@/lib/note-markdown';
import { useColors } from '@/theme/colors';

// A note from the paired Mac's knowledge folder. Reading renders it as a
// document (wiki links open other notes, checkboxes, meeting transcripts —
// lib/note-markdown.ts). Edit (2026-10-28) opens the body as plain markdown;
// Save writes it back with the frontmatter untouched, and refuses to overwrite
// a note that changed on the Mac meanwhile (the etag from the read).
// Relative image refs go to the server's authenticated /workspace route.

function rewriteImageRefs(markdown: string, noteDir: string, baseUrl: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
    (_m, alt: string, ref: string) => {
      const rel = ref.startsWith('/') ? ref.slice(1) : noteDir ? `${noteDir}/${ref}` : ref;
      return `![${alt}](${baseUrl}/workspace/${rel.split('/').map(encodeURIComponent).join('/')})`;
    },
  );
}

interface Loaded {
  frontmatter: string;
  body: string;
  etag: string;
}

export default function NoteViewScreen() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const { rpc, events, pairing } = useConnection();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [note, setNote] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // non-null while editing
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const editingRef = useRef(false);
  editingRef.current = editing;

  const refresh = useCallback(async () => {
    if (!rpc || !path) return;
    try {
      const result = await rpc.call('workspace:readFile', { path });
      const { frontmatter, body } = splitFrontmatter(result.data);
      setNote({ frontmatter, body, etag: result.etag });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [rpc, path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    analytics.mobileNoteOpened();
  }, []);

  useEffect(() => {
    if (!events) return;
    // Live notes update themselves on the Mac; refetch when this file changes,
    // but never under an open edit (Save checks the etag instead).
    const off = events.on('workspace:didChange', (payload) => {
      const e = payload as { type: string; path: string };
      if (e.path === path && !editingRef.current) void refresh();
    });
    return off;
  }, [events, path, refresh]);

  const save = useCallback(async () => {
    if (!rpc || !path || !note || draft === null) return;
    if (draft === note.body) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      const result = await rpc.call('workspace:writeFile', {
        path,
        data: note.frontmatter + draft,
        opts: { atomic: true, expectedEtag: note.etag },
      });
      setNote({ ...note, body: draft, etag: result.etag });
      setDraft(null);
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/etag/i.test(message)) {
        Alert.alert('This note changed on your Mac', 'Your edits weren’t saved. Copy anything you need, then reload to see the latest version.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Reload', style: 'destructive', onPress: () => { setDraft(null); void refresh(); } },
        ]);
      } else {
        Alert.alert('Couldn’t save the note', message);
      }
    } finally {
      setSaving(false);
    }
  }, [rpc, path, note, draft, refresh]);

  const cancel = useCallback(() => {
    if (draft === null || draft === note?.body) {
      setDraft(null);
      return;
    }
    Alert.alert('Discard your changes?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => setDraft(null) },
    ]);
  }, [draft, note]);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (!editingRef.current) return;
      e.preventDefault();
      Alert.alert('Discard your changes?', undefined, [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation]);

  const title = path?.split('/').pop()?.replace(/\.md$/, '') ?? 'Note';
  const noteDir = path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  const headerButton = (label: string, onPress: () => void, bold?: boolean) => (
    <Pressable hitSlop={10} onPress={onPress} disabled={saving}>
      <Text style={{ fontSize: 17, fontWeight: bold ? '600' : '400', color: colors.label, opacity: saving ? 0.4 : 1 }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerBackVisible: !editing,
          headerLeft: editing ? () => headerButton('Cancel', cancel) : undefined,
          headerRight: () =>
            saving ? (
              <ActivityIndicator size="small" />
            ) : editing ? (
              headerButton('Save', () => void save(), true)
            ) : note ? (
              headerButton('Edit', () => setDraft(note.body))
            ) : null,
        }}
      />
      {editing ? (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            scrollEnabled
            textAlignVertical="top"
            placeholder="Write in markdown"
            placeholderTextColor={colors.tertiaryLabel}
            style={[styles.editor, { color: colors.label, paddingBottom: insets.bottom + 24 }]}
          />
        </KeyboardAvoidingView>
      ) : (
        <ScrollView
          style={{ backgroundColor: colors.background }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.container}
        >
          {error && <Text selectable style={{ color: colors.destructive, marginBottom: 8 }}>{error}</Text>}
          {note === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
          {note !== null && (
            <ChatMarkdown
              variant="document"
              onLinkPress={(url) => {
                if (!url.startsWith(NOTE_LINK)) return true;
                router.push({ pathname: '/notes/view', params: { path: decodeURIComponent(url.slice(NOTE_LINK.length)) } });
                return false;
              }}
              extraRules={{
                // Workspace images sit behind the server's bearer auth, so the
                // default <img> rendering won't do — attach the header per image.
                image: (node: { key: string; attributes: { src?: string } }) => (
                  <Image
                    key={node.key}
                    source={{
                      uri: String(node.attributes.src ?? ''),
                      headers: pairing ? { Authorization: `Bearer ${pairing.token}` } : undefined,
                    }}
                    style={styles.image}
                    resizeMode="contain"
                  />
                ),
              }}
            >
              {rpc ? rewriteImageRefs(noteToRenderable(note.body), noteDir, rpc.baseUrl) : noteToRenderable(note.body)}
            </ChatMarkdown>
          )}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48 },
  image: { width: '100%', height: 220, marginVertical: 8 },
  editor: { flex: 1, fontSize: 16, lineHeight: 23, paddingHorizontal: 16, paddingTop: 12 },
});
