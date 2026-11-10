import { Redirect, useLocalSearchParams } from 'expo-router';
import { LinkWait, useLinkServer } from '@/lib/spaces/link-gate';

// What hangs under a space link (2026-11-09): /m/<messageId> opens the thread
// on that message (a reply's id resolves to its root on the thread screen);
// anything else (/a/<assetId>, /c/…) opens the space's chat, where the file
// list is a tap away.
export default function SpaceSubLink() {
  const { spaceId, rest } = useLocalSearchParams<{ spaceId: string; rest: string[] | string }>();
  const org = useLinkServer();
  if (org === 'wait') return <LinkWait />;
  if (org === 'home') return <Redirect href="/spaces" />;
  const parts = Array.isArray(rest) ? rest : rest ? [rest] : [];
  const base = { org: org.address, space: spaceId, me: org.memberId };
  if (parts[0] === 'm' && parts[1]) {
    return <Redirect href={{ pathname: '/spaces/thread', params: { ...base, root: parts[1], title: 'Thread', focus: 'latest' } }} />;
  }
  return <Redirect href={{ pathname: '/spaces/chat', params: base }} />;
}
