import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { Member } from '@rowboat/spaces-protocol';
import { mentionToken } from '@rowboat/spaces-protocol';

import { useColors } from '@/theme/colors';

// The space composer (Slack's rounded field) with @-mentions. Pill in, token
// out: typing "@" opens a picker over the roster (+ @here, @rowboat); a pick
// writes "@Name" into the field and remembers name → id; on send every
// remembered "@Name" (and a bare @here / @rowboat) becomes the wire token
// `[@Name](#member:<id>)` — the only spelling the org stamps (mentions.ts).
// A bare @word nobody picked stays prose, as the contract says it should.

export interface SpaceComposerHandle {
  focus(): void;
  /** Prefill a quote of another message ("> …") and focus. */
  quote(text: string): void;
  /** Switch to editing an existing message: its body in the field, send = save. */
  beginEdit(id: string, body: string): void;
}

interface MentionPick {
  label: string;
  id: string; // member id, or 'here' / 'rowboat'
}

const FIXED: MentionPick[] = [
  { label: 'here', id: 'here' },
  { label: 'rowboat', id: 'rowboat' },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "@Name" text → wire tokens, for the labels the composer knows about. */
export function tokenizeMentions(text: string, picked: ReadonlyMap<string, MentionPick>): string {
  const labels = [...picked.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const label of labels) {
    const pick = picked.get(label)!;
    const token =
      pick.id === 'here' || pick.id === 'rowboat'
        ? mentionToken({ kind: pick.id })
        : mentionToken({ kind: 'member', id: pick.id, label: pick.label });
    out = out.replace(new RegExp(`(^|[\\s([{])@${escapeRe(label)}(?![\\w])(?!\\]\\(#)`, 'g'), `$1${token}`);
  }
  // Fixed addresses typed by hand still count — they are deliberate. The
  // lookahead skips an "@here" that is already a token's label.
  out = out.replace(/(^|[\s([{])@(here|rowboat)(?![\w])(?!\]\(#)/g, (_m, pre: string, kind: 'here' | 'rowboat') => `${pre}${mentionToken({ kind })}`);
  return out;
}

/** The "@query" the cursor sits in, if any. */
function activeMention(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  if (at > 0 && !/[\s([{]/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (/[\n]/.test(query)) return null;
  return { start: at, query };
}

export const SpaceComposer = forwardRef<SpaceComposerHandle, {
  placeholder: string;
  members: Member[];
  me: string;
  sending: boolean;
  onSend: (body: string) => void;
  /** Upload a picked photo/video and return the markdown to insert (absent = no + button). */
  onPickMedia?: (file: { uri: string; mime: string; name: string }) => Promise<string>;
  /** Save an edit begun with beginEdit (absent = editing unsupported). */
  onEdit?: (id: string, body: string) => void;
}>(function SpaceComposer({ placeholder, members, me, sending, onSend, onPickMedia, onEdit }, ref) {
  const colors = useColors();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Map<string, MentionPick>>(new Map());
  const [uploading, setUploading] = useState(false);
  // The native multiline field keeps its grown height after the text is
  // cleared — remount it after a send so it snaps back to one line.
  const [inputKey, setInputKey] = useState(0);
  // Picked media rides as thumbnails above the field (iMessage/Slack); the
  // wire markdown joins the body only on send.
  const [attachments, setAttachments] = useState<{ key: string; uri: string; md: string; video: boolean }[]>([]);

  const pickMedia = async () => {
    if (!onPickMedia || uploading) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.85 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setUploading(true);
    try {
      const video = asset.type === 'video';
      const md = await onPickMedia({
        uri: asset.uri,
        mime: asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
        name: asset.fileName ?? `${video ? 'video' : 'photo'}-${Date.now()}`,
      });
      setAttachments((prev) => [...prev, { key: `${Date.now()}`, uri: asset.uri, md, video }]);
    } finally {
      setUploading(false);
    }
  };

  const [editing, setEditing] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      quote: (quoted: string) => {
        const block = quoted.split('\n').map((l) => `> ${l}`).join('\n') + '\n\n';
        setText((prev) => (prev.trim() ? `${prev}\n${block}` : block));
        setCursor((c) => c + block.length);
        inputRef.current?.focus();
      },
      beginEdit: (id: string, body: string) => {
        setEditing(id);
        setText(body);
        setCursor(body.length);
        setAttachments([]);
        inputRef.current?.focus();
      },
    }),
    [],
  );

  const cancelEdit = () => {
    setEditing(null);
    setText('');
    setInputKey((k) => k + 1);
  };

  const active = useMemo(() => activeMention(text, cursor), [text, cursor]);
  const suggestions = useMemo(() => {
    if (!active) return [];
    const q = active.query.toLowerCase();
    const people: MentionPick[] = members
      .filter((m) => m.id !== me && m.displayName.toLowerCase().includes(q))
      .slice(0, 6)
      .map((m) => ({ label: m.displayName, id: m.id }));
    const fixed = FIXED.filter((f) => f.label.startsWith(q));
    return [...people, ...fixed];
  }, [active, members, me]);

  const pick = useCallback(
    (p: MentionPick) => {
      if (!active) return;
      if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
      const insert = `@${p.label} `;
      const next = text.slice(0, active.start) + insert + text.slice(cursor);
      setText(next);
      setCursor(active.start + insert.length);
      setPicked((prev) => new Map(prev).set(p.label, p));
    },
    [active, text, cursor],
  );

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !uploading;
  const send = () => {
    if (!canSend) return;
    const words = tokenizeMentions(text.trim(), picked);
    const body = [words, ...attachments.map((a) => a.md)].filter(Boolean).join('\n');
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
    Keyboard.dismiss();
    const editingId = editing;
    setEditing(null);
    setText('');
    setPicked(new Map());
    setAttachments([]);
    setInputKey((k) => k + 1);
    if (editingId && onEdit) onEdit(editingId, body);
    else onSend(body);
  };

  // Picked mentions read as pills: bold spans inside the field.
  const styled = useMemo(() => {
    const labels = [...picked.keys()].sort((a, b) => b.length - a.length);
    if (labels.length === 0) return text;
    const re = new RegExp(`(@(?:${labels.map(escapeRe).join('|')}))(?![\\w])`, 'g');
    const parts = text.split(re);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <Text key={i} style={{ fontWeight: '600', color: '#0a84ff' }}>{part}</Text>
      ) : (
        part
      ),
    );
  }, [text, picked]);

  return (
    <View>
      {suggestions.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingBottom: 6 }}
        >
          {suggestions.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => pick(s)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingLeft: 6, paddingRight: 10, paddingVertical: 5, borderRadius: 16,
                backgroundColor: pressed ? colors.separator : colors.secondaryBackground,
              })}
            >
              <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.separator }}>
                {s.id === 'here' || s.id === 'rowboat' ? (
                  <Image source={s.id === 'here' ? 'sf:megaphone' : 'sf:sparkles'} style={{ width: 11, height: 11 }} tintColor={colors.label} />
                ) : (
                  <Text style={{ fontSize: 10, fontWeight: '600', color: colors.label }}>{(s.label[0] ?? '?').toUpperCase()}</Text>
                )}
              </View>
              <Text style={{ fontSize: 14, color: colors.label }}>@{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {/* Slack's composer card: field on top, toolbar below (@ · send). */}
      <View
        style={{
          marginHorizontal: 12,
          borderRadius: 18, borderCurve: 'continuous',
          borderWidth: 0.5, borderColor: colors.separator,
          backgroundColor: colors.secondaryBackground,
          paddingHorizontal: 14, paddingTop: 4, paddingBottom: 6,
        }}
      >
        {editing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10 }}>
            <Image source="sf:pencil" style={{ width: 13, height: 13 }} tintColor={colors.secondaryLabel} />
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.secondaryLabel }}>Editing message</Text>
            <Pressable hitSlop={8} onPress={cancelEdit}>
              <Text style={{ fontSize: 13, color: '#0a84ff' }}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
        {attachments.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10, paddingBottom: 2 }}>
            {attachments.map((a) => (
              <View key={a.key} style={{ width: 64, height: 64 }}>
                <Image source={{ uri: a.uri }} style={{ width: 64, height: 64, borderRadius: 10 }} contentFit="cover" />
                {a.video ? (
                  <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <Image source="sf:play.circle.fill" style={{ width: 22, height: 22 }} tintColor="#ffffff" />
                  </View>
                ) : null}
                <Pressable
                  hitSlop={6}
                  onPress={() => setAttachments((prev) => prev.filter((x) => x.key !== a.key))}
                  style={{
                    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
                    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.label,
                  }}
                >
                  <Image source="sf:xmark" style={{ width: 9, height: 9 }} tintColor={colors.background} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <TextInput
          ref={inputRef}
          key={inputKey}
          style={{ minHeight: 40, maxHeight: 140, fontSize: 16, lineHeight: 22, color: colors.label, paddingVertical: 8 }}
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryLabel}
          onChangeText={setText}
          onSelectionChange={(e) => setCursor(e.nativeEvent.selection.end)}
          multiline
        >
          {styled}
        </TextInput>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 2 }}>
          {onPickMedia ? (
            <Pressable
              hitSlop={8}
              disabled={uploading}
              onPress={() => void pickMedia()}
              style={{
                width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
                backgroundColor: colors.background === '#000000' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                opacity: uploading ? 0.5 : 1,
              }}
            >
              {uploading ? <ActivityIndicator size="small" /> : <Image source="sf:plus" style={{ width: 14, height: 14 }} tintColor={colors.secondaryLabel} />}
            </Pressable>
          ) : null}
          <Pressable
            hitSlop={8}
            onPress={() => {
              // Insert "@" at the cursor and open the picker.
              const at = cursor;
              const needsSpace = at > 0 && !/[\s([{]/.test(text[at - 1] ?? '');
              const insert = `${needsSpace ? ' ' : ''}@`;
              setText(text.slice(0, at) + insert + text.slice(at));
              setCursor(at + insert.length);
              inputRef.current?.focus();
            }}
          >
            <Image source="sf:at" style={{ width: 22, height: 22 }} tintColor={colors.secondaryLabel} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            hitSlop={8}
            onPress={send}
            disabled={!canSend}
            style={{ opacity: canSend ? 1 : 0.3 }}
          >
            <Image source={editing ? "sf:checkmark.circle.fill" : "sf:paperplane.fill"} style={{ width: 22, height: 22 }} tintColor={colors.label} />
          </Pressable>
        </View>
      </View>
    </View>
  );
});
