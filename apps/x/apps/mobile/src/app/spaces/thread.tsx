import { reportMobileActivity } from '../../lib/spaces/activity';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from '@/components/sf-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useHomeBackButton } from '@/components/home-back';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';
import { onServer, type Approval, type Invocation, type Member, type Message, type Space, type Topic } from '@rowboat/spaces-protocol';

import { spaces } from '@x/shared';

import { ChatMarkdown } from '@/components/markdown';
import { MessageLinkPreviews } from '@/components/link-preview-card';
import { SpaceBlobImage, parseBlobLink } from '@/components/space-blob-image';
import { MessageActionSheet, MessageBody, MessageRow, applyReaction, fileLinkRule, nameFileLinks, parseAssetLink } from '@/components/space-message';
import { SpaceComposer, type SpaceComposerHandle } from '@/components/space-composer';
import { PollCard, applyPollVote } from '@/components/poll-card';
import { ApprovalCard } from '@/components/approval-card';
import { InvocationLines } from '@/components/invocation-lines';
import { foldInvocations, frameInvocation, invocationsByMessage, useAgentsCanStop } from '@/lib/spaces/invocations';
import { setActiveSpace } from '@/lib/push';
import { useSpacesAccount } from '@/lib/spaces/account';
import { AuthedImage } from '@/components/avatar';
import { StatusBanner } from '@/components/status-banner';
import { friendlyError, isNetworkError } from '@/lib/spaces/errors';
import { blobLinkName, isVideoName, openBlobFile } from '@/lib/spaces/open-blob';
import { postMessageReliably } from '@/lib/spaces/send';
import { loadRoster, loadThread, peekRoster, peekThread, peekValue, saveRoster, saveThread } from '@/lib/spaces/cache';
import { SpacesClient } from '@/lib/spaces/client';
import { isDeparted, answersOwnerOnly, memberLabel, useProfiles } from '@/lib/spaces/profiles';
import { blockMember, reportMessage, useBlockedIds } from '@/lib/spaces/moderation';
import { SpacesLive } from '@x/spaces-client';
import { ThreadOptionsSheet, type ThreadChange } from '@/components/thread-options';
import { withArchived, withSession } from '@/lib/spaces/threads';
import { useColors } from '@/theme/colors';

// One flat thread: root pinned on top, replies below, composer posts with
// threadRoot. Live folds replies + reactions addressed to this thread.
export default function SpaceThreadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  // The header is see-through (soft scroll edge): content insets itself.
  // Android's header is solid (spaces/_layout.tsx), so content already starts below it.
  const headerHeight = useHeaderHeight() * (process.env.EXPO_OS === 'android' ? 0 : 1);
  const account = useSpacesAccount();
  const params = useLocalSearchParams<{ org: string; space: string; root: string; title: string; me: string; focus?: string }>();
  const { org, space, root, me } = params;

  const client = useMemo(
    () => new SpacesClient({ baseUrl: `https://${org}`, token: (opts) => account.getAccessToken(opts) }),
    [org, account],
  );

  // Paint from cache synchronously when we can (stream-seeded root, or a
  // thread opened earlier this session); the fetch below replaces it.
  const initial = peekThread(org, space, root);
  const [rootMessage, setRootMessage] = useState<Message | null>(initial?.root ?? null);
  const [replies, setReplies] = useState<Message[] | null>(initial?.messages ?? null);
  const [members, setMembers] = useState<Map<string, Member>>(() => new Map((peekRoster(org, space) ?? []).map((m) => [m.id, m])));
  const profiles = useProfiles(client, members);
  // File names by id (2026-10-28), so a bare file link in a message shows the
  // file's name instead of its URL.
  const [fileNames, setFileNames] = useState<ReadonlyMap<string, string>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    client
      .listAssets(space)
      .then((list) => !cancelled && setFileNames(new Map(list.map((a) => [a.id, a.path]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, space]);
  // People you blocked (2026-10-20): their messages are hidden on this phone.
  const blockedIds = useBlockedIds(org);
  const blockedKey = [...blockedIds].join(',');
  const memberNames = useMemo(() => new Map([...profiles].map(([id, m]) => [id, memberLabel(m)])), [profiles]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reactionsOnly, setReactionsOnly] = useState(false);
  const [following, setFollowing] = useState<boolean | null>(initial?.following ?? null);
  // The thread's discussion row (2026-11-13): null = a plain thread or a
  // session, undefined = not loaded yet. Its options sheet changes both.
  const [topic, setTopic] = useState<Topic | null | undefined>(undefined);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const applyChange = useCallback((change: ThreadChange) => {
    if (change.root) setRootMessage(change.root);
    if (change.topic !== undefined) setTopic(change.topic);
  }, []);
  // Thread follow-ups (Harbor spec §8, 2026-10-27): a reply that mentions
  // nobody goes to the agent you last invoked here. The line over the composer
  // names it; its × sends the next reply to people only.
  // The thread's invocations are also the agent lines under messages
  // (2026-11-13): read on open and on every resubscribe, folded from live
  // `invocation_state` frames and from your own posts.
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [peopleOnly, setPeopleOnly] = useState(false);
  const [draftMentions, setDraftMentions] = useState(false);
  // Only while that conversation is the thread's latest (2026-11-05, "reply ux" in Main).
  const followUp = useMemo(() => {
    const thread = rootMessage ? [rootMessage, ...(replies ?? [])] : [];
    const id = spaces.followUpAgentId(invocations, root, me, thread);
    const agent = id ? members.get(id) : undefined;
    return agent && !answersOwnerOnly(agent, me) ? agent : undefined;
  }, [invocations, root, me, members, rootMessage, replies]);
  const scrollRef = useRef<ScrollView>(null);
  const composerRef = useRef<SpaceComposerHandle>(null);
  const lastOffset = useRef<number | undefined>(undefined);
  // Land on the root (what you tapped). Scroll down only for a reply that
  // arrives live or that you send — never because a refresh swapped the list.
  // Opened from a notification or an Activity reply (focus=latest): you came
  // for the newest reply, so land at the bottom and stay there while replies
  // and previews load — until you scroll yourself. Opened by tapping a
  // message, a thread lands on its root as before.
  // The bell's answer: a line that says what tapping it just did.
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashNote = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2200);
  }, []);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  const pinLatest = useRef(params.focus === 'latest');
  const [revealed, setRevealed] = useState(params.focus !== 'latest');
  const onThreadContentSize = useCallback(() => {
    if (!pinLatest.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
      requestAnimationFrame(() => setRevealed(true));
    });
  }, []);
  const scrollToNewest = useCallback(() => {
    // After the new row is laid out — an earlier scroll aims at the old end.
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }, []);

  if (lastOffset.current === undefined && initial?.messages) {
    lastOffset.current = initial.messages.at(-1)?.offset ?? initial.root.offset;
  }

  useEffect(() => {
    let cancelled = false;
    // Disk cache (after a relaunch) — only if nothing better is on screen yet.
    void Promise.all([loadThread(org, space, root), loadRoster(org, space)]).then(([cached, roster]) => {
      if (cancelled) return;
      if (roster) setMembers((prev) => (prev.size ? prev : new Map(roster.map((m) => [m.id, m]))));
      if (!cached?.messages) return;
      setRootMessage((prev) => prev ?? cached.root);
      setReplies((prev) => {
        if (prev) return prev;
        lastOffset.current = cached.messages!.at(-1)?.offset ?? cached.root.offset;
        return cached.messages;
      });
      setFollowing((prev) => prev ?? cached.following);
    });
    // Names don't block the thread: each request lands on its own.
    client
      .listMembers(space)
      .then((memberList) => {
        if (cancelled) return;
        setMembers(new Map(memberList.map((m) => [m.id, m])));
        saveRoster(org, space, memberList);
      })
      .catch(() => {});
    client
      .listInvocations(space, root)
      .then((list) => !cancelled && setInvocations((prev) => foldInvocations(prev, list)))
      .catch(() => {});
    client
      .listThread(space, root)
      .then((thread) => {
        if (cancelled) return;
        // A message link may name a reply (2026-11-10); the server answers with
        // its root. Live replies, read marks and sends key on the root, so take
        // the root's id as the param and load again under it.
        if (thread.root.id !== root) {
          router.setParams({ root: thread.root.id });
          return;
        }
        const freshLast = thread.messages.at(-1)?.offset ?? thread.root.offset;
        setRootMessage(thread.root);
        setTopic(thread.topic);
        // Keep anything live delivered after the server's snapshot.
        setReplies((prev) => [...thread.messages, ...(prev ?? []).filter((m) => m.offset > freshLast && !thread.messages.some((f) => f.id === m.id))]);
        setFollowing(thread.following);
        lastOffset.current = Math.max(lastOffset.current ?? 0, freshLast);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [client, org, space, root]);

  // Deleted replies vanish (Slack) — they anchor nothing.
  const visibleReplies = useMemo(
    () => replies?.filter((m) => !m.deletedAt && !blockedIds.has(m.author.memberId)) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- blockedKey stands for blockedIds
    [replies, blockedKey],
  );

  // Write-through: whatever is on screen is what the next open paints.
  useEffect(() => {
    if (rootMessage && replies) saveThread(org, space, { root: rootMessage, messages: replies, following });
  }, [org, space, rootMessage, replies, following]);

  useEffect(() => {
    if (replies === null) return;
    const live = new SpacesLive({ baseUrl: `https://${org}`, token: () => account.getAccessToken() });
    const stopActivity = reportMobileActivity(live);
    const off = live.subscribe(
      space,
      (frame) => {
        if (frame.kind === 'invocation_state') {
          if (frame.invocation.conversation.threadRootId === root) setInvocations((prev) => foldInvocations(prev, [frameInvocation(frame)]));
          return;
        }
        // State frames are never replayed: a resubscribe reads the snapshot again.
        if (frame.kind === 'subscribed') {
          client.listInvocations(space, root).then((list) => setInvocations((prev) => foldInvocations(prev, list))).catch(() => {});
          return;
        }
        if (frame.kind !== 'event') return;
        const event = frame.event;
        if (event.type === 'approval') {
          patchApproval(event.approval);
        } else if (event.type === 'message' && event.message.threadRoot === root) {
          setReplies((prev) => {
            if (!prev || prev.some((m) => m.id === event.message.id)) return prev;
            scrollToNewest();
            return [...prev, event.message];
          });
        } else if (event.type === 'message_deleted') {
          const patch = (m: Message) => (m.id === event.deletion.messageId ? { ...m, body: '', deletedAt: event.deletion.at } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'message_edited') {
          const patch = (m: Message) => (m.id === event.edit.messageId ? { ...m, body: event.edit.body, editedAt: event.edit.at } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'reaction') {
          const patch = (m: Message) => (m.id === event.reaction.messageId ? applyReaction(m, event.reaction.emoji, event.reaction.by.memberId, event.action) : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'poll_vote') {
          const patch = (m: Message) => (m.id === event.vote.messageId && m.poll ? { ...m, poll: applyPollVote(m.poll, { answerId: event.vote.answerId, memberId: event.vote.by.memberId, action: event.action }) } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'poll_ended') {
          const patch = (m: Message) => (m.id === event.end.messageId && m.poll ? { ...m, poll: { ...m.poll, endedAt: event.end.at } } : m);
          setRootMessage((prev) => (prev ? patch(prev) : prev));
          setReplies((prev) => prev?.map(patch) ?? null);
        } else if (event.type === 'thread_archive' && event.rootMessageId === root) {
          // Archived, ended or revived from anywhere (2026-11-13): the header and menu follow.
          setRootMessage((prev) => (prev ? withArchived(prev, event.action === 'archived') : prev));
        } else if (event.type === 'thread_session' && event.rootMessageId === root) {
          setRootMessage((prev) => (prev ? withSession(prev, event.session) : prev));
        } else if (event.type === 'topic' && event.topic.rootMessageId === root) {
          setTopic(event.topic);
        } else if (event.type === 'topic_removed' && event.removal.rootMessageId === root) {
          setTopic(null);
        }
      },
      lastOffset.current,
    );
    return () => {
      off();
      stopActivity();
      live.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect once per screen after first load
  }, [replies === null, org, space, root]);


  // A tapped attachment: the server's videos play in the app; other files
  // download with the bearer and open in the share sheet (Quick Look, Save to
  // Files); other hosts go to the browser.
  const [openingFile, setOpeningFile] = useState(false);
  const openBlobLink = useCallback(
    (link: { host: string; spaceId: string; hash: string; url: string }) => {
      if (!onServer(link.host, org)) {
        void Linking.openURL(link.url);
        return;
      }
      const name = blobLinkName(link.url, 'file');
      if (isVideoName(name)) {
        router.push({ pathname: '/spaces/video', params: { org, space: link.spaceId, hash: link.hash, name } });
        return;
      }
      if (openingFile) return;
      setOpeningFile(true);
      openBlobFile(client, link.spaceId, link.hash, name)
        .catch((err) => Alert.alert("Couldn't open the file", friendlyError(err, "You're offline. Try again when you're back online.")))
        .finally(() => setOpeningFile(false));
    },
    [client, org, openingFile],
  );

  // A file link in a message: the server's files open in the file screen (by
  // id, so a rename never breaks it); any other host goes to the browser.
  const openAssetLink = useCallback(
    (link: { host: string; spaceId: string; assetId: string }) => {
      if (!onServer(link.host, org)) {
        void Linking.openURL(`https://${link.host}/s/${link.spaceId}/a/${link.assetId}`);
        return;
      }
      router.push({ pathname: '/spaces/file', params: { org, space: link.spaceId, assetId: link.assetId, path: '', title: 'File', mime: '' } });
    },
    [org],
  );

  const send = async (body: string): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    // The × holds for one reply.
    const toPeople = peopleOnly && followUp !== undefined && !spaces.mentionsAnyone(body);
    setPeopleOnly(false);
    try {
      const { message, invocations: started } = await postMessageReliably(
        client,
        space,
        { body, threadRoot: root, ...(toPeople ? { peopleOnly: true } : {}) },
        me,
      );
      setInvocations((prev) => foldInvocations(prev, started));
      setReplies((prev) => (prev && !prev.some((m) => m.id === message.id) ? [...prev, message] : prev));
      scrollToNewest();
      return true;
    } catch (err) {
      if (!isNetworkError(err)) setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSending(false);
    }
  };

  // Thread read mark: the newest reply on screen (a thread takes a mark
  // whether or not we follow it — CONTRACT.md amendment 2026-09-11).
  const newestReply = replies?.at(-1)?.offset;
  useEffect(() => {
    if (newestReply === undefined) return;
    const t = setTimeout(() => void client.markRead(space, { threadRootId: root, offset: newestReply }).catch(() => {}), 800);
    return () => clearTimeout(t);
  }, [client, space, root, newestReply]);

  useEffect(() => {
    setActiveSpace(space);
    return () => setActiveSpace(null);
  }, [space]);

  const patchBoth = useCallback((folded: Message) => {
    setRootMessage((prev) => (prev && prev.id === folded.id ? folded : prev));
    setReplies((prev) => prev?.map((m) => (m.id === folded.id ? folded : m)) ?? null);
  }, []);

  // Agent lines and approval cards (2026-11-13, desktop parity). Roles are the
  // space's: an admin may stop anyone's agent. Harbor refuses anything else.
  // The roster is held as Member; listMembers' rows carry the space role.
  const self = members.get(me);
  const isAdmin = !!self && 'role' in self && self.role === 'admin';
  const linesByMessage = useMemo(() => invocationsByMessage(invocations), [invocations]);
  const runningAgents = useMemo(
    () => [...new Set(invocations.filter((i) => i.state === 'working' || i.state === 'waiting').map((i) => i.agentId))],
    [invocations],
  );
  const canStop = useAgentsCanStop(client, org, runningAgents);
  const foldInvocation = useCallback((updated: Invocation) => setInvocations((prev) => foldInvocations(prev, [updated])), []);
  const linesFor = (message: Message) => {
    const list = linesByMessage.get(message.id);
    if (!list?.some((i) => i.state !== 'done')) return undefined;
    return <InvocationLines invocations={list} memberNames={memberNames} me={me} isAdmin={isAdmin} canStop={canStop} client={client} onUpdated={foldInvocation} />;
  };
  // An approval event carries the whole approval; keep whichever copy is newer.
  const patchApproval = useCallback((approval: Approval) => {
    const patch = (m: Message) => (m.approval?.id === approval.id && m.approval.updatedAt <= approval.updatedAt ? { ...m, approval } : m);
    setRootMessage((prev) => (prev ? patch(prev) : prev));
    setReplies((prev) => prev?.map(patch) ?? null);
  }, []);
  const cardFor = (message: Message) =>
    message.approval ? (
      <ApprovalCard approval={message.approval} client={client} me={me} memberNames={memberNames} ownerOf={(id) => members.get(id)?.ownerId} onDecided={patchApproval} />
    ) : undefined;
  const quote = useCallback((message: Message) => composerRef.current?.quote(spaces.resolveMentions(message.body, memberNames)), [memberNames]);
  const beginEdit = useCallback((message: Message) => composerRef.current?.beginEdit(message.id, message.body), []);
  const saveEdit = useCallback(
    (id: string, body: string) =>
      client.editMessage(space, id, { body, actingMode: 'direct' }).then(
        (m) => {
          patchBoth(m);
          return true;
        },
        (err) => {
          if (!isNetworkError(err)) setError(err instanceof Error ? err.message : String(err));
          return false;
        },
      ),
    [client, space, patchBoth],
  );
  const confirmDelete = useCallback(
    (message: Message) => {
      Alert.alert('Delete message?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            client.deleteMessage(space, message.id, { actingMode: 'direct' }).then(patchBoth).catch((err) => setError(err instanceof Error ? err.message : String(err)));
          },
        },
      ]);
    },
    [client, space, patchBoth],
  );
  const linkFor = useCallback((message: Message) => `https://${org}/s/${space}/m/${message.id}`, [org, space]);

  // "+" media: upload the bytes to the space's blob store and hand the
  // composer the canonical wire link (space-blob-image.tsx renders it).
  const uploadMedia = useCallback(
    async (file: { uri: string; mime: string; name: string }) => {
      const bytes = new Uint8Array(await (await fetch(file.uri)).arrayBuffer());
      const blob = await client.uploadBlob(space, bytes, { declaredMime: file.mime });
      const qs = new URLSearchParams({ name: file.name });
      if (blob.width && blob.height) {
        qs.set('w', String(blob.width));
        qs.set('h', String(blob.height));
      }
      const link = `https://${org}/s/${space}/b/${blob.hash}?${qs.toString()}`;
      // Brackets in a file name would end the markdown label early.
      const label = file.name.replace(/[\[\]]/g, '_');
      return blob.mime.startsWith('image/') ? `![${label}](${link})` : `[${label}](${link})`;
    },
    [client, org, space],
  );

  const vote = useCallback(
    (message: Message, answerIds: number[]) => {
      void (async () => {
        try {
          let latest = message;
          for (const answerId of answerIds) latest = await client.votePoll(space, message.id, { answerId, action: 'add', actingMode: 'direct' });
          patchBoth(latest);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [client, space, patchBoth],
  );
  const removeVote = useCallback(
    (message: Message) => {
      const mine = message.poll?.votes.filter((g) => g.memberIds.includes(me)).map((g) => g.answerId) ?? [];
      void (async () => {
        let latest = message;
        for (const answerId of mine) latest = await client.votePoll(space, message.id, { answerId, action: 'remove', actingMode: 'direct' }).catch(() => latest);
        patchBoth(latest);
      })();
    },
    [client, space, me, patchBoth],
  );
  const endPoll = useCallback(
    (message: Message) => {
      client.endPoll(space, message.id, { actingMode: 'direct' }).then(patchBoth).catch((err) => setError(err instanceof Error ? err.message : String(err)));
    },
    [client, space, patchBoth],
  );

  const toggleReaction = useCallback(
    (message: Message, emoji: string) => {
      const mine = message.reactions.some((g) => g.emoji === emoji && g.memberIds.includes(me));
      const patchWith = (folded: Message) => {
        setRootMessage((prev) => (prev && prev.id === folded.id ? folded : prev));
        setReplies((prev) => prev?.map((m) => (m.id === folded.id ? folded : m)) ?? null);
      };
      patchWith(applyReaction(message, emoji, me, mine ? 'removed' : 'added'));
      client
        .reactToMessage(space, message.id, { emoji, action: mine ? 'remove' : 'add', actingMode: 'direct' })
        .then(patchWith)
        .catch(() => patchWith(message));
    },
    [client, space, me],
  );

  // Links and pushes pass no space name (title 'Thread', 2026-11-10): name it
  // from Home's cached list, and leave a DM unnamed.
  const cachedSpace = peekValue<Space[]>(`spaces:${org}`)?.find((s) => s.id === space);
  const spaceName = params.title && params.title !== 'Thread' ? params.title : cachedSpace?.kind === 'direct' ? undefined : cachedSpace?.name;

  const homeBack = useHomeBackButton();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior="padding" keyboardVerticalOffset={0}>
      <Stack.Screen
        options={{
          headerLeft: homeBack,
          // A discussion's or session's title leads the header, its kind and space
          // under it (2026-11-13): a title line above the root message repeated the
          // root's own text, since a session is usually named after it.
          headerTitle: () => {
            const kind = topic ? 'Discussion' : rootMessage?.session ? 'Session' : 'Thread';
            const named = topic?.title ?? rootMessage?.session?.title;
            return (
              <View style={{ alignItems: 'center', maxWidth: 220 }}>
                <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>{named ?? kind}</Text>
                {named || spaceName ? (
                  <Text numberOfLines={1} style={{ fontSize: 12, color: colors.tertiaryLabel }}>
                    {[named ? kind : null, spaceName ? `#${spaceName}` : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            );
          },
          // Follow = replies land in Activity + notifications (Slack's bell).
          // The ⋯ beside it is the thread's options (2026-11-13), once the thread has loaded.
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
              {following === null ? null : (
                <Pressable
                  hitSlop={10}
                  onPress={() => {
                    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
                    const next = !following;
                    setFollowing(next);
                    flashNote(next ? 'Following — you’ll be notified of new replies' : 'Unfollowed — no notifications for this thread');
                    client.followThread(space, root, next).catch(() => {
                      setFollowing(!next);
                      flashNote('Couldn’t change that. Try again.');
                    });
                  }}
                >
                  <Image source={following ? 'sf:bell.fill' : 'sf:bell.slash'} style={{ width: 20, height: 20 }} contentFit="contain" tintColor={following ? colors.label : colors.tertiaryLabel} />
                </Pressable>
              )}
              {topic === undefined || !rootMessage || rootMessage.deletedAt ? null : (
                <Pressable hitSlop={10} accessibilityLabel="Thread options" onPress={() => setOptionsOpen(true)}>
                  <Image source="sf:ellipsis.circle" style={{ width: 21, height: 21 }} contentFit="contain" tintColor={colors.label} />
                </Pressable>
              )}
            </View>
          ),
        }}
      />
      {rootMessage === null && !error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          onContentSizeChange={onThreadContentSize}
          onScrollBeginDrag={() => { pinLatest.current = false; }}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
          style={{ flex: 1, opacity: revealed ? 1 : 0 }}
          contentContainerStyle={{ paddingVertical: 12 }}
        >
          <StatusBanner error={error} offlineText={replies ? "You're offline. Showing saved replies." : "You're offline. Replies will load when you're back online."} />
          {rootMessage ? (
            <ThreadHeading
              topic={topic ?? null}
              root={rootMessage}
              fileName={topic?.documentAssetId ? fileNames.get(topic.documentAssetId) : undefined}
              onOpenFile={(assetId) => router.push({ pathname: '/spaces/file', params: { org, space, assetId, path: '', title: 'File', mime: '' } })}
            />
          ) : null}
          {rootMessage?.deletedAt ? (
            <MessageRow message={rootMessage} me={me} onToggleReaction={toggleReaction} onLongPress={() => {}} />
          ) : rootMessage ? (
            <RootMessage
              message={rootMessage}
              member={profiles.get(rootMessage.author.memberId)}
              memberNames={memberNames} fileNames={fileNames}
              me={me}
              onToggleReaction={toggleReaction}
              onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }}
              onVote={vote}
              onRemoveVote={removeVote}
              onEndPoll={endPoll}
              onOpenAsset={openAssetLink} onOpenBlob={openBlobLink}
              approvalCard={cardFor(rootMessage)}
              invocationLines={linesFor(rootMessage)}
            />
          ) : null}
          {rootMessage && visibleReplies !== null ? (
            <Pressable
              onPress={visibleReplies.length === 0 ? () => composerRef.current?.focus() : undefined}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4,
                paddingHorizontal: 16, paddingVertical: 12,
                borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: colors.separator,
              }}
            >
              {visibleReplies.length === 0 ? (
                <>
                  <Image source="sf:bubble.left" style={{ width: 17, height: 17 }} tintColor={colors.secondaryLabel} />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.secondaryLabel }}>Reply in Thread</Text>
                </>
              ) : (
                <Text style={{ fontSize: 15, color: colors.secondaryLabel }}>
                  {visibleReplies.length} {visibleReplies.length === 1 ? 'reply' : 'replies'}
                </Text>
              )}
            </Pressable>
          ) : null}
          {/* Root painted from the stream; replies still on their way. */}
          {rootMessage && replies === null && !error ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
          {visibleReplies?.map((m) => (
            <MessageRow key={m.id} message={m} member={profiles.get(m.author.memberId)} memberNames={memberNames} fileNames={fileNames} me={me} onToggleReaction={toggleReaction} onLongPress={(m) => { setReactionsOnly(false); setActionMessage(m); }} onOpenAsset={openAssetLink} onOpenBlob={openBlobLink}
              onAddReaction={(m) => { setReactionsOnly(true); setActionMessage(m); }} onVote={vote} onRemoveVote={removeVote} onEndPoll={endPoll}
              approvalCard={cardFor(m)} invocationLines={linesFor(m)} />
          ))}
        </ScrollView>
      )}

      {note ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: headerHeight + 8, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.label }}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: colors.background }}>{note}</Text>
          </View>
        </View>
      ) : null}

      {/* Composer */}
      <View style={{ paddingTop: 8, paddingBottom: keyboardVisible ? 16 : insets.bottom + 10 }}>
        {followUp && !draftMentions ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingBottom: 6 }}>
            {peopleOnly ? (
              <>
                <Text style={{ fontSize: 13, color: colors.secondaryLabel }}>To people only ·</Text>
                <Pressable onPress={() => setPeopleOnly(false)} hitSlop={8} accessibilityRole="button">
                  <Text style={{ fontSize: 13, color: colors.label }}>Include {memberLabel(followUp)}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 13, color: colors.secondaryLabel }}>
                  Replying to <Text style={{ fontWeight: '600', color: colors.label }}>{memberLabel(followUp)}</Text>
                </Text>
                <Pressable
                  onPress={() => setPeopleOnly(true)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Send to people only, not ${memberLabel(followUp)}`}
                >
                  <Image source="sf:xmark" style={{ width: 10, height: 10 }} tintColor={colors.secondaryLabel} />
                </Pressable>
              </>
            )}
          </View>
        ) : null}
        <SpaceComposer
          ref={composerRef}
          placeholder="Add a reply"
          members={[...members.values()].filter((m) => !isDeparted(m) && !answersOwnerOnly(m, me))}
          me={me}
          sending={sending}
          onSend={send}
          onPickMedia={uploadMedia}
          onEdit={saveEdit}
          onDraftChange={(draft) => setDraftMentions(spaces.mentionsAnyone(draft))}
          draftKey={`${org}:${space}:${root}`}
        />
      </View>

      <MessageActionSheet
        reactionsOnly={reactionsOnly}
        message={actionMessage}
        me={me}
        onClose={() => setActionMessage(null)}
        onToggleReaction={toggleReaction}
        onQuote={quote}
        onEdit={beginEdit}
        onDelete={confirmDelete}
        onReport={(m) => reportMessage({ org, message: m, author: profiles.get(m.author.memberId), getAccessToken: () => account.getAccessToken() })}
        onBlock={(m) => blockMember({ org, spaceId: space, member: { id: m.author.memberId, name: profiles.get(m.author.memberId)?.displayName ?? 'this person' }, getAccessToken: () => account.getAccessToken() })}
        linkFor={linkFor}
      />
      <ThreadOptionsSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        client={client}
        org={org}
        space={space}
        root={rootMessage}
        topic={topic ?? null}
        onChange={applyChange}
      />
    </KeyboardAvoidingView>
  );
}

// The root, Slack-style: 40pt avatar, bold name with the timestamp UNDER it,
// full-size body, then reaction pills + the always-on emoji+ pill.
function RootMessage({ message, member, memberNames, fileNames, me, onToggleReaction, onLongPress, onAddReaction, onVote, onRemoveVote, onEndPoll, onOpenAsset, onOpenBlob, approvalCard, invocationLines }: {
  message: Message;
  member?: Member;
  memberNames: ReadonlyMap<string, string>;
  fileNames?: ReadonlyMap<string, string>;
  me: string;
  onToggleReaction: (message: Message, emoji: string) => void;
  onLongPress: (message: Message) => void;
  onAddReaction: (message: Message) => void;
  onVote: (message: Message, answerIds: number[]) => void;
  onRemoveVote: (message: Message) => void;
  onEndPoll: (message: Message) => void;
  onOpenAsset?: (link: { host: string; spaceId: string; assetId: string; label: string }) => void;
  onOpenBlob?: (link: { host: string; spaceId: string; hash: string; url: string }) => void;
  /** As on MessageRow (2026-11-13): an approval card in place of the body, and the agent lines under it. */
  approvalCard?: ReactNode;
  invocationLines?: ReactNode;
}) {
  const colors = useColors();
  const name = member ? memberLabel(member) : message.author.memberId;
  const body = nameFileLinks(spaces.decorateMentions(message.body, memberNames), fileNames);
  // Same authed blob-image rule the chat rows use — the default renderer
  // can't fetch Harbor blobs.
  const imageRule = useMemo(
    () => ({
      image: (node: { key: string; attributes: { src?: string } }) =>
        node.attributes.src ? <SpaceBlobImage key={node.key} src={node.attributes.src} /> : null,
      link: fileLinkRule(colors.label),
    }),
    [colors.label],
  );
  const posted = new Date(message.postedAt);
  const today = new Date().toDateString() === posted.toDateString();
  const stamp = `${today ? 'Today' : posted.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${posted.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <Pressable
      onLongPress={() => {
        if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onLongPress(message);
      }}
      delayLongPress={250}
      style={{ paddingHorizontal: 16, paddingTop: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <View
          style={{
            width: 40, height: 40, borderRadius: 10, borderCurve: 'continuous',
            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryBackground, overflow: 'hidden',
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '600', color: colors.label }}>{(name[0] ?? '?').toUpperCase()}</Text>
          {member?.avatarUrl ? <AuthedImage url={member.avatarUrl} style={{ position: 'absolute', top: 0, left: 0, width: 40, height: 40 }} /> : null}
        </View>
        <View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.label }}>{name}</Text>
          <Text style={{ fontSize: 13, color: colors.tertiaryLabel }}>{stamp}</Text>
        </View>
      </View>
      {message.approval && approvalCard ? (
        approvalCard
      ) : message.poll ? (
        <PollCard message={message} poll={message.poll} me={me} onVote={onVote} onRemoveVote={onRemoveVote} onEndPoll={onEndPoll} />
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
      {invocationLines}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
        {message.reactions.map((g) => {
          const mine = g.memberIds.includes(me);
          return (
            <Pressable
              key={g.emoji}
              onPress={() => onToggleReaction(message, g.emoji)}
              style={{
                flexDirection: 'row', gap: 4, paddingHorizontal: 9, paddingVertical: 4,
                borderRadius: 14, backgroundColor: colors.secondaryBackground,
                borderWidth: 1, borderColor: mine ? colors.label : 'transparent',
              }}
            >
              <Text style={{ fontSize: 14 }}>{g.emoji}</Text>
              <Text style={{ fontSize: 14, fontWeight: mine ? '600' : '400', color: mine ? colors.label : colors.secondaryLabel }}>{g.memberIds.length}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => onAddReaction(message)}
          style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4,
            borderRadius: 14, backgroundColor: colors.secondaryBackground,
          }}
        >
          <Image source="sf:face.smiling" style={{ width: 16, height: 16 }} tintColor={colors.secondaryLabel} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.secondaryLabel, marginLeft: 1, marginTop: -7 }}>+</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// What this thread is (2026-11-13, the web pane's title line), minus the
// title, which the header carries: whether it is archived or ended, and a
// discussion's linked file. A plain, active thread shows nothing here.
function ThreadHeading({ topic, root, fileName, onOpenFile }: {
  topic: Topic | null;
  root: Message;
  fileName?: string;
  onOpenFile: (assetId: string) => void;
}) {
  const colors = useColors();
  const archived = topic ? topic.archived : !!root.archived;
  if (!archived && !topic?.documentAssetId) return null;
  const state = archived ? (!topic && root.session ? 'Ended' : 'Archived') : null;
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
      {state ? (
        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: colors.secondaryBackground }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: colors.secondaryLabel }}>{state}</Text>
        </View>
      ) : null}
      {topic?.documentAssetId ? (
        <Pressable
          onPress={() => onOpenFile(topic.documentAssetId!)}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
            paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderCurve: 'continuous',
            backgroundColor: colors.secondaryBackground, opacity: pressed ? 0.6 : 1,
          })}
        >
          <Image source="sf:paperclip" style={{ width: 14, height: 14 }} tintColor={colors.secondaryLabel} />
          <Text numberOfLines={1} style={{ fontSize: 14, color: colors.label, maxWidth: 260 }}>{fileName ?? 'Linked file'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
