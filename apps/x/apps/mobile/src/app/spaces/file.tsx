import { Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatMarkdown } from '@/components/markdown';
import { useSpacesAccount } from '@/lib/spaces/account';
import { SpacesClient } from '@/lib/spaces/client';
import { friendlyError } from '@/lib/spaces/errors';
import { showFileActions } from '@/lib/spaces/file-actions';
import { documentToRenderable } from '@/lib/note-markdown';
import { SpacesLive } from '@x/spaces-client';
import { useColors } from '@/theme/colors';

// One file by asset id: markdown rendered as a document, other text in mono,
// images from the blob store. Changesets on this id refresh it live.
// The name comes from the file itself (2026-10-28): a file opened from a link
// in a message arrives with no path, and used to fall back to raw text.
// Text files can be edited: Save proposes a change on the version that was
// read; the org applies it, merges it with edits made meanwhile, or reports a
// conflict (then nothing is saved and the user can reload).
const PLAIN_TEXT_EXTENSIONS = new Set([
  'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'log', 'env', 'ini', 'sql', 'sh',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'php',
]);

export default function SpaceFileScreen() {
  const colors = useColors();
  const account = useSpacesAccount();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ org: string; space: string; assetId: string; path: string; title: string; mime: string }>();
  const { org, space, assetId } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  const [content, setContent] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [path, setPath] = useState<string>(params.path ?? '');
  const [imageUri, setImageUri] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // non-null while editing
  const [saving, setSaving] = useState(false);
  const editing = draft !== null;
  const editingRef = useRef(false);
  editingRef.current = editing;

  const load = useCallback(async () => {
    try {
      const result = await client.readAsset(space, assetId);
      setPath(result.path);
      setVersion(result.version);
      if (result.blob) {
        // Binary: images render inline; anything else just states itself.
        const token = await account.getAccessToken();
        if (result.blob.mime.startsWith('image/')) {
          setImageUri({
            uri: `https://${org}/v1/spaces/${encodeURIComponent(space)}/blobs/${result.blob.hash}`,
            headers: { Authorization: `Bearer ${token}` },
          });
        } else {
          setError(`${result.blob.mime} — no preview on the phone yet`);
        }
      } else {
        setContent(result.content);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client, account, org, space, assetId]);

  useEffect(() => {
    void load();
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const off = live.subscribe(space, (frame) => {
      // Someone else's change: refresh, unless an edit is open (Save merges it).
      if (frame.kind === 'event' && frame.event.type === 'change' && frame.event.changeSet.assetId === assetId && !editingRef.current) void load();
    });
    return () => {
      off();
      live.close();
    };
  }, [load, account, org, space, assetId]);

  const save = useCallback(async () => {
    if (draft === null || version === null || content === null) return;
    if (draft === content) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      const result = await client.proposeChange(space, { assetId, baseVersion: version, newContent: draft, reason: 'Edited on mobile', actingMode: 'direct' });
      if (result.outcome === 'conflict') {
        Alert.alert('Someone else changed this file', 'Your edit overlaps with theirs, so it wasn’t saved. Copy anything you need, then reload to see the latest version.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Reload', style: 'destructive', onPress: () => { setDraft(null); void load(); } },
        ]);
        return;
      }
      setContent(result.outcome === 'merged' ? result.mergedContent : draft);
      setVersion(result.version);
      setDraft(null);
      if (process.env.EXPO_OS === 'ios') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Couldn’t save the file', friendlyError(err));
    } finally {
      setSaving(false);
    }
  }, [client, space, assetId, version, content, draft, load]);

  const confirmDiscard = (onDiscard: () => void) =>
    Alert.alert('Discard your changes?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onDiscard },
    ]);

  const cancel = () => (draft === content ? setDraft(null) : confirmDiscard(() => setDraft(null)));

  // Leaving with unsaved edits asks first.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!editingRef.current) return;
        e.preventDefault();
        confirmDiscard(() => navigation.dispatch(e.data.action));
      }),
    [navigation],
  );

  // Markdown unless the name says it's code or data (2026-10-28): space notes
  // are often saved without an extension, and those are markdown too.
  const ext = /\.([a-z0-9]+)$/i.exec(path.split('/').pop() ?? '')?.[1]?.toLowerCase();
  const markdown = !ext || !PLAIN_TEXT_EXTENSIONS.has(ext);
  const name = path.split('/').pop() || params.title || 'File';
  const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

  const headerButton = (label: string, onPress: () => void, bold?: boolean) => (
    <Pressable hitSlop={10} onPress={onPress} disabled={saving}>
      <Text style={{ fontSize: 17, fontWeight: bold ? '600' : '400', color: colors.label, opacity: saving ? 0.4 : 1 }}>{label}</Text>
    </Pressable>
  );

  const header = (
    <Stack.Screen
      options={{
        title: name,
        headerBackVisible: !editing,
        headerLeft: editing ? () => headerButton('Cancel', cancel) : undefined,
        headerRight: () =>
          saving ? (
            <ActivityIndicator size="small" />
          ) : editing ? (
            headerButton('Save', () => void save(), true)
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              <Pressable hitSlop={10} accessibilityLabel="Share file" onPress={() => showFileActions({ client, org, space, assetId, name })}>
                <ExpoImage source="sf:square.and.arrow.up" style={{ width: 19, height: 22 }} contentFit="contain" tintColor={colors.label} />
              </Pressable>
              {content !== null ? headerButton('Edit', () => setDraft(content)) : null}
            </View>
          ),
      }}
    />
  );

  if (editing) {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
        {header}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          multiline
          autoFocus
          scrollEnabled
          textAlignVertical="top"
          autoCapitalize={markdown ? 'sentences' : 'none'}
          autoCorrect={markdown}
          style={{
            flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 24, color: colors.label,
            ...(markdown ? { fontSize: 16, lineHeight: 23 } : { fontFamily: mono, fontSize: 13, lineHeight: 19 }),
          }}
        />
      </KeyboardAvoidingView>
    );
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      {header}
      {error ? <Text style={{ fontSize: 13, color: colors.destructive }}>{error}</Text> : null}
      {content === null && imageUri === null && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
      {imageUri ? (
        <Image source={imageUri} style={{ width: width - 32, height: width - 32, borderRadius: 10 }} resizeMode="contain" />
      ) : null}
      {content !== null ? (
        markdown ? (
          <ChatMarkdown variant="document">{documentToRenderable(content)}</ChatMarkdown>
        ) : (
          <Text selectable style={{ fontFamily: mono, fontSize: 13, lineHeight: 19, color: colors.label }}>
            {content}
          </Text>
        )
      ) : null}
    </ScrollView>
  );
}
