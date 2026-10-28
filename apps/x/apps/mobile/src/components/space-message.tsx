import * as Haptics from 'expo-haptics';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { spaces } from '@x/shared';

import { ChatMarkdown } from '@/components/markdown';
import { MessageLinkPreviews } from '@/components/link-preview-card';
import { PollCard } from '@/components/poll-card';
import { SpaceBlobImage, parseBlobLink } from '@/components/space-blob-image';
import { EmojiPicker } from '@/components/emoji-picker';
import { AuthedImage } from '@/components/avatar';
import { BottomSheet } from '@/components/bottom-sheet';
import { useColors } from '@/theme/colors';
import { memberLabel } from '@/lib/spaces/profiles';

/** The contract's file link: https://<org>/s/<spaceId>/a/<assetId> (the label is the file's name at write time). */
const ASSET_LINK_RE = /^https:\/\/([^/?#]+)\/s\/([^/?#]+)\/a\/([^/?#]+)$/;
export function parseAssetLink(url: string): { host: string; spaceId: string; assetId: string; label: string } | null {
  const m = ASSET_LINK_RE.exec(url);
  if (!m) return null;
  return { host: m[1]!, spaceId: m[2]!, assetId: decodeURIComponent(m[3]!), label: '' };
}

/**
 * File links read as the file (2026-10-28): a bare link (pasted, or written by
 * an agent) has only its URL as text, so it gets the file's name from the
 * space's listing. Code is left alone.
 */
const BARE_ASSET_LINK_RE = /(^|[^(\[<])(https:\/\/[^\s/?#]+\/s\/[^\s/?#]+\/a\/[^\s)?#<>]+)/g;
export function nameFileLinks(body: string, fileNames?: ReadonlyMap<string, string>): string {
  const named = (url: string) => {
    const link = parseAssetLink(url);
    return ((link && fileNames?.get(link.assetId)?.split('/').pop()) || 'File').replace(/[[\]]/g, '');
  };
  return body
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            // A link whose label is its own URL ([url](url), as the composer
            // writes a pasted link) is as good as bare.
            .replace(/\[(https:\/\/[^\]\s]+)\]\((https:\/\/[^)\s]+)\)/g, (m, label: string, url: string) =>
              label === url && parseAssetLink(url) ? `[${named(url)}](${url})` : m,
            )
            .replace(BARE_ASSET_LINK_RE, (_m, lead: string, url: string) => `${lead}[${named(url)}](${url})`),
    )
    .join('');
}

/** What kind of file a name is, for the card's second line. */
function fileKind(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext || ext === 'md' || ext === 'markdown') return 'Document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return 'Image';
  if (ext === 'pdf') return 'PDF';
  if (['csv', 'tsv', 'xlsx'].includes(ext)) return 'Spreadsheet';
  return `${ext.toUpperCase()} file`;
}

const FILE_LINE_RE = /^\s*\[([^\]]+)\]\((https:\/\/[^\s/?#]+\/s\/[^\s/?#]+\/a\/[^\s)?#]+)\)\s*$/;
type BodySegment = { kind: 'markdown'; text: string } | { kind: 'file'; name: string; url: string };

/** Split a message into markdown and the file links that stand on their own line. */
function splitFileCards(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let buffer: string[] = [];
  let fence = false;
  const flush = () => {
    const text = buffer.join('\n');
    if (text.trim()) out.push({ kind: 'markdown', text });
    buffer = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : FILE_LINE_RE.exec(line);
    if (m) {
      flush();
      out.push({ kind: 'file', name: m[1]!, url: m[2]! });
    } else buffer.push(line);
  }
  flush();
  return out;
}

/**
 * A file shared on its own line (2026-10-28): a card — icon, name, and what it
 * is and where it lives — instead of an inline link. Tapping opens the file.
 */
function FileCard({ name, path, onPress }: { name: string; path?: string; onPress?: () => void }) {
  const colors = useColors();
  const folder = path && path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start', maxWidth: 320, minWidth: 220,
        marginVertical: 4, paddingVertical: 10, paddingHorizontal: 12,
        borderRadius: 12, borderCurve: 'continuous', borderWidth: 0.5, borderColor: colors.separator,
        backgroundColor: pressed ? colors.separator : colors.secondaryBackground,
      })}
    >
      <Image source="sf:doc.text" style={{ width: 22, height: 22 }} contentFit="contain" tintColor={colors.secondaryLabel} />
      <View style={{ flexShrink: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>{name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.secondaryLabel }}>{[fileKind(name), folder].filter(Boolean).join(' · ')}</Text>
      </View>
    </Pressable>
  );
}

/** A message body: markdown, with files on their own line as cards. */
export function MessageBody({ body, fileNames, rules, onLinkPress }: {
  body: string;
  /** asset id → path in the space. */
  fileNames?: ReadonlyMap<string, string>;
  rules: Record<string, unknown>;
  onLinkPress: (url: string) => boolean;
}) {
  const segments = useMemo(() => splitFileCards(body), [body]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === 'markdown' ? (
          <ChatMarkdown key={i} extraRules={rules} onLinkPress={onLinkPress}>
            {seg.text}
          </ChatMarkdown>
        ) : (
          <FileCard key={i} name={seg.name} path={fileNames?.get(parseAssetLink(seg.url)?.assetId ?? '')} onPress={() => void onLinkPress(seg.url)} />
        ),
      )}
    </>
  );
}

/**
 * Markdown link rule: a file link is a file label (📄 name, no underline);
 * other links keep the default look. Taps go through onLinkPress either way.
 */
export function fileLinkRule(labelColor: string) {
  return (node: { key: string; attributes: { href?: string } }, children: ReactNode, _parent: unknown, styles: { link?: object }, onLinkPress?: (url: string) => boolean) => {
    const href = String(node.attributes.href ?? '');
    const file = parseAssetLink(href) !== null;
    return (
      <Text
        key={node.key}
        style={file ? { fontWeight: '600', color: labelColor } : styles.link}
        onPress={() => {
          if (onLinkPress?.(href) !== false) void Linking.openURL(href).catch(() => {});
        }}
      >
        {file ? '📄 ' : null}
        {children}
      </Text>
    );
  };
}

// Shared message presentation for the stream and thread screens: row, reaction
// chips, long-press action sheet. All server calls stay in the screens — this
// file only renders and calls back.

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '🙏'];

/** Local fold of one reaction toggle — mirrors the server's read-side fold. */
export function applyReaction(message: Message, emoji: string, memberId: string, action: 'added' | 'removed'): Message {
  const groups = message.reactions.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
  const group = groups.find((g) => g.emoji === emoji);
  if (action === 'added') {
    if (group) {
      if (!group.memberIds.includes(memberId)) group.memberIds.push(memberId);
    } else {
      groups.push({ emoji, memberIds: [memberId] });
    }
  } else if (group) {
    group.memberIds = group.memberIds.filter((id) => id !== memberId);
  }
  return { ...message, reactions: groups.filter((g) => g.memberIds.length > 0) };
}

// Deterministic avatar tint per author so rows scan like Slack's, without
// shipping profile images. Muted so both themes keep contrast with the initial.
const AVATAR_HUES = [211, 32, 145, 262, 90, 340, 174, 20];
function avatarColor(id: string, dark: boolean): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]}, 45%, ${dark ? 32 : 82}%)`;
}

export const MessageRow = memo(function MessageRow({
  message,
  member,
  memberNames,
  fileNames,
  me,
  onToggleReaction,
  onOpenThread,
  onLongPress,
  onAddReaction,
  alwaysShowReactionBar,
  onVote,
  onRemoveVote,
  onEndPoll,
  onOpenAsset,
  onOpenBlob,
}: {
  message: Message;
  member?: Member;
  /** id → displayName for the whole space — resolves @<memberId> mentions. */
  memberNames?: ReadonlyMap<string, string>;
  /** asset id → file name, so bare file links show the file's name. */
  fileNames?: ReadonlyMap<string, string>;
  me: string;
  onToggleReaction: (message: Message, emoji: string) => void;
  /** Omit on the thread screen (replies have no threads). */
  onOpenThread?: (message: Message) => void;
  onLongPress: (message: Message) => void;
  /** The emoji+ pill — a reactions-only picker (defaults to the full sheet). */
  onAddReaction?: (message: Message) => void;
  /** Thread root: keep the emoji+ pill visible even with zero reactions (Slack). */
  alwaysShowReactionBar?: boolean;
  /** Polls: cast / withdraw / end. Absent = read-only card. */
  onVote?: (message: Message, answerIds: number[]) => void;
  onRemoveVote?: (message: Message) => void;
  onEndPoll?: (message: Message) => void;
  /** A tapped file link (https://<org>/s/<spaceId>/a/<assetId>) — the screen opens the file or hands it to the browser. */
  onOpenAsset?: (link: { host: string; spaceId: string; assetId: string; label: string }) => void;
  /** A tapped attachment (https://<org>/s/<spaceId>/b/<hash>?name=…) — the screen downloads and opens it. */
  onOpenBlob?: (link: { host: string; spaceId: string; hash: string; url: string }) => void;
}) {
  const colors = useColors();
  const dark = colors.isDark;
  const name = member ? memberLabel(member) : message.author.memberId;
  const agent = message.author.actingMode !== 'direct';
  const time = new Date(message.postedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Wire member addresses ("@01ABC…") → bold display names, code spans untouched.
  const body = useMemo(
    () => nameFileLinks(memberNames ? spaces.decorateMentions(message.body, memberNames) : message.body, fileNames),
    [message.body, memberNames, fileNames],
  );

  // Long-press a reaction chip → who reacted (opens on that emoji's tab).
  const [reactorsFor, setReactorsFor] = useState<string | null>(null);

  const imageRule = useMemo(
    () => ({
      image: (node: { key: string; attributes: { src?: string } }) =>
        node.attributes.src ? <SpaceBlobImage key={node.key} src={node.attributes.src} /> : null,
      link: fileLinkRule(colors.label),
    }),
    [colors.label],
  );

  // Deleted messages are filtered out by the screens (Slack); one that still
  // has replies stays as a placeholder so its thread remains reachable.
  if (message.deletedAt) {
    return (
      <Pressable
        onPress={onOpenThread && message.replyCount > 0 ? () => onOpenThread(message) : undefined}
        style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 6 }}
      >
        <View
          style={{
            width: 34, height: 34, borderRadius: 8, borderCurve: 'continuous', marginTop: 2,
            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground,
          }}
        >
          <Image source="sf:trash" style={{ width: 15, height: 15 }} tintColor={colors.tertiaryLabel} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
          <Text style={{ fontSize: 15, color: colors.tertiaryLabel }}>This message was deleted.</Text>
          {onOpenThread && message.replyCount > 0 ? (
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0a84ff' }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'} ›
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <>
    <Pressable
      // Tap opens the thread (Slack); long-press keeps the action sheet.
      onPress={onOpenThread ? () => onOpenThread(message) : undefined}
      onLongPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(message);
      }}
      delayLongPress={250}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 6,
        backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
      })}
    >
      <View
        style={{
          width: 34, height: 34, borderRadius: 8, borderCurve: 'continuous', marginTop: 2,
          alignItems: 'center', justifyContent: 'center', backgroundColor: avatarColor(message.author.memberId, dark), overflow: 'hidden',
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>
          {(name[0] ?? '?').toUpperCase()}
        </Text>
        {member?.avatarUrl ? <AuthedImage url={member.avatarUrl} style={{ position: 'absolute', top: 0, left: 0, width: 34, height: 34 }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.label }}>
            {name}
            {agent ? <Text style={{ fontWeight: '400', color: colors.tertiaryLabel }}>  (agent)</Text> : null}
          </Text>
          <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>{time}</Text>
          {message.editedAt ? <Text style={{ fontSize: 12, color: colors.tertiaryLabel }}>(edited)</Text> : null}
        </View>
        {message.poll ? (
          <PollCard
            message={message}
            poll={message.poll}
            me={me}
            onVote={onVote ?? (() => {})}
            onRemoveVote={onRemoveVote ?? (() => {})}
            onEndPoll={onEndPoll}
          />
        ) : (
          <>
            <MessageBody
              body={body}
              fileNames={fileNames}
              rules={imageRule}
              onLinkPress={(url) => {
                const blob = parseBlobLink(url);
                if (blob && onOpenBlob) {
                  onOpenBlob({ ...blob, url });
                  return false;
                }
                const link = parseAssetLink(url);
                if (!link || !onOpenAsset) return true;
                onOpenAsset(link);
                return false;
              }}
            />
            <MessageLinkPreviews body={message.body} />
          </>
        )}
        {message.reactions.length > 0 || alwaysShowReactionBar ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {message.reactions.map((g) => {
              const mine = g.memberIds.includes(me);
              return (
                <Pressable
                  key={g.emoji}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    onToggleReaction(message, g.emoji);
                  }}
                  onLongPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setReactorsFor(g.emoji);
                  }}
                  delayLongPress={250}
                  style={{
                    flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
                    borderRadius: 12, backgroundColor: colors.secondaryBackground,
                    borderWidth: 1, borderColor: mine ? colors.label : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 13 }}>{g.emoji}</Text>
                  <Text style={{ fontSize: 13, fontWeight: mine ? '600' : '400', color: mine ? colors.label : colors.secondaryLabel }}>
                    {g.memberIds.length}
                  </Text>
                </Pressable>
              );
            })}
            {/* Slack's add-reaction pill: emoji picker only. */}
            <Pressable
              onPress={() => {
                if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                (onAddReaction ?? onLongPress)(message);
              }}
              style={{
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3,
                borderRadius: 12, backgroundColor: colors.secondaryBackground,
              }}
            >
              <Image source="sf:face.smiling" style={{ width: 14, height: 14 }} tintColor={colors.secondaryLabel} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.secondaryLabel, marginLeft: 1, marginTop: -6 }}>+</Text>
            </Pressable>
          </View>
        ) : null}
        {onOpenThread && message.replyCount > 0 ? (
          <Pressable onPress={() => onOpenThread(message)} hitSlop={6} style={{ marginTop: 4, alignSelf: 'flex-start' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0a84ff' }}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'} ›
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
    {reactorsFor !== null ? (
      <ReactorsSheet
        message={message}
        initial={reactorsFor}
        me={me}
        memberNames={memberNames}
        onClose={() => setReactorsFor(null)}
      />
    ) : null}
    </>
  );
});

/**
 * Who reacted (Slack's reactions sheet): an "All" tab plus one tab per emoji,
 * each listing the people behind it. Names come from the space roster; you
 * show as "You".
 */
function ReactorsSheet({
  message,
  initial,
  me,
  memberNames,
  onClose,
}: {
  message: Message;
  initial: string;
  me: string;
  memberNames?: ReadonlyMap<string, string>;
  onClose: () => void;
}) {
  const colors = useColors();
  const dark = colors.isDark;
  const [tab, setTab] = useState<string>(initial);
  const nameOf = (id: string) => (id === me ? 'You' : memberNames?.get(id) ?? 'Unknown member');
  const total = message.reactions.reduce((n, g) => n + g.memberIds.length, 0);
  const rows =
    tab === 'all'
      ? message.reactions.flatMap((g) => g.memberIds.map((id) => ({ id, emoji: g.emoji })))
      : (message.reactions.find((g) => g.emoji === tab)?.memberIds ?? []).map((id) => ({ id, emoji: tab }));

  const tabs = [{ key: 'all', label: `All ${total}` }, ...message.reactions.map((g) => ({ key: g.emoji, label: `${g.emoji} ${g.memberIds.length}` }))];

  return (
    <BottomSheet visible={true} onClose={onClose} maxHeight={0.6}
      style={{ paddingTop: 10, paddingBottom: 34, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: colors.background }}
    >
          <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: colors.separator, marginBottom: 12 }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10 }}>
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    setTab(t.key);
                  }}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: on ? colors.label : colors.secondaryBackground }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: on ? colors.background : colors.label }}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ height: 0.5, backgroundColor: colors.separator }} />
          <ScrollView contentContainerStyle={{ paddingVertical: 6 }}>
            {rows.map(({ id, emoji }) => {
              const name = nameOf(id);
              return (
                <View key={`${emoji}:${id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
                  <View
                    style={{
                      width: 32, height: 32, borderRadius: 8, borderCurve: 'continuous',
                      alignItems: 'center', justifyContent: 'center', backgroundColor: avatarColor(id, dark),
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.label }}>{(name[0] ?? '?').toUpperCase()}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: colors.label }}>{name}</Text>
                  {tab === 'all' ? <Text style={{ fontSize: 20 }}>{emoji}</Text> : null}
                </View>
              );
            })}
          </ScrollView>
    </BottomSheet>
  );
}

/** Long-press sheet: quick reactions + reply. Kept dependency-free (RN Modal). */
export function MessageActionSheet({
  message,
  me,
  onClose,
  onToggleReaction,
  onReply,
  onQuote,
  onEdit,
  onDelete,
  onReport,
  onBlock,
  linkFor,
  reactionsOnly,
}: {
  message: Message | null;
  me: string;
  onClose: () => void;
  onToggleReaction: (message: Message, emoji: string) => void;
  /** Omit on the thread screen — the composer is already the reply box. */
  onReply?: (message: Message) => void;
  onQuote?: (message: Message) => void;
  /** Author-only (the content plane is role-flat). */
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  /** Someone else's message only (App Store Guideline 1.2, 2026-10-20). */
  onReport?: (message: Message) => void;
  onBlock?: (message: Message) => void;
  /** The message's canonical link (https://<org>/s/<space>/m/<id>). */
  linkFor?: (message: Message) => string;
  /** The emoji+ pill's mode: just the reactions row. */
  reactionsOnly?: boolean;
}) {
  const colors = useColors();
  const [more, setMore] = useState(false);
  if (!message) return null;
  const mine = new Set(message.reactions.filter((g) => g.memberIds.includes(me)).map((g) => g.emoji));
  const isAuthor = message.author.memberId === me;

  // Slack's long-press menu, cut to what the org supports.
  const actions: { key: string; icon: string; label: string; destructive?: boolean; run: () => void }[] = [];
  if (onReply) actions.push({ key: 'reply', icon: 'sf:arrowshape.turn.up.left', label: 'Reply in thread', run: () => onReply(message) });
  if (onQuote) actions.push({ key: 'quote', icon: 'sf:quote.opening', label: 'Quote reply', run: () => onQuote(message) });
  actions.push({ key: 'copy', icon: 'sf:doc.on.doc', label: 'Copy message', run: () => void Clipboard.setStringAsync(message.body) });
  if (linkFor) actions.push({ key: 'link', icon: 'sf:link', label: 'Copy link', run: () => void Clipboard.setStringAsync(linkFor(message)) });
  if (isAuthor && onEdit && !message.poll) actions.push({ key: 'edit', icon: 'sf:pencil', label: 'Edit message', run: () => onEdit(message) });
  if (isAuthor && onDelete) actions.push({ key: 'delete', icon: 'sf:trash', label: 'Delete message', destructive: true, run: () => onDelete(message) });
  if (!isAuthor && onReport) actions.push({ key: 'report', icon: 'sf:flag', label: 'Report message', destructive: true, run: () => onReport(message) });
  if (!isAuthor && onBlock) actions.push({ key: 'block', icon: 'sf:hand.raised', label: 'Block this person', destructive: true, run: () => onBlock(message) });

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            marginHorizontal: 12, marginBottom: 40, padding: 10, gap: 6,
            borderRadius: 20, borderCurve: 'continuous', backgroundColor: colors.background,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: reactionsOnly ? 0 : 4 }}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => {
                  if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                  onToggleReaction(message, emoji);
                  onClose();
                }}
                style={{
                  width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: mine.has(emoji) ? colors.secondaryBackground : 'transparent',
                }}
              >
                <Text style={{ fontSize: 26 }}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setMore(true)}
              style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground }}
            >
              <Image source="sf:plus" style={{ width: 18, height: 18 }} tintColor={colors.secondaryLabel} />
            </Pressable>
          </View>
          <EmojiPicker
            visible={more}
            onClose={() => setMore(false)}
            onPick={(emoji) => {
              onToggleReaction(message, emoji);
              onClose();
            }}
          />
          {!reactionsOnly
            ? actions.map((a) => (
                <Pressable
                  key={a.key}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    onClose();
                    // After the menu's fade-out (2026-10-20): presenting a sheet or
                    // alert over a dismissing modal can crash on iOS.
                    setTimeout(a.run, 350);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46,
                    paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous',
                    backgroundColor: pressed ? colors.secondaryBackground : 'transparent',
                  })}
                >
                  <Image source={a.icon} style={{ width: 20, height: 20 }} tintColor={a.destructive ? colors.destructive : colors.secondaryLabel} />
                  <Text style={{ fontSize: 16, color: a.destructive ? colors.destructive : colors.label }}>{a.label}</Text>
                </Pressable>
              ))
            : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
