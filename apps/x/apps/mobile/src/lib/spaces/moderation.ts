import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type { Member, Message } from '@rowboat/spaces-protocol';

import { ACCOUNT_API_URL } from './account';
import { friendlyError } from './errors';

// Report and block (App Store Guideline 1.2, 2026-10-20). A report goes to
// rowboatx-backend (POST /v1/report), which saves it and emails the team for
// review within 24 hours. A block hides that person's messages and DM on this
// phone and files a report too, so the team also sees it. Blocks are kept per
// org on the device: member ids are per org, and blocking is a local filter.

const STORE_KEY = 'spaces.blocked.v1';

export interface BlockedMember {
  id: string;
  name: string;
}

type BlockedByOrg = Record<string, BlockedMember[]>;

let blocked: BlockedByOrg = {};
let loaded = false;
const listeners = new Set<() => void>();

async function load() {
  if (loaded) return;
  const raw = await AsyncStorage.getItem(STORE_KEY).catch(() => null);
  blocked = raw ? (JSON.parse(raw) as BlockedByOrg) : {};
  loaded = true;
  for (const l of listeners) l();
}

function save() {
  void AsyncStorage.setItem(STORE_KEY, JSON.stringify(blocked)).catch(() => {});
  for (const l of listeners) l();
}

/** Blocked members, per org address. Re-renders when the list changes. */
export function useBlocked(): BlockedByOrg {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((n) => n + 1);
    listeners.add(listener);
    void load();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return blocked;
}

/** Ids blocked in one org, for filtering a screen's messages and people. */
export function useBlockedIds(org: string): Set<string> {
  const all = useBlocked();
  return new Set((all[org] ?? []).map((m) => m.id));
}

export function unblock(org: string, memberId: string) {
  blocked = { ...blocked, [org]: (blocked[org] ?? []).filter((m) => m.id !== memberId) };
  if (blocked[org].length === 0) delete blocked[org];
  save();
}

interface ReportInput {
  kind: 'message' | 'user';
  org: string;
  spaceId?: string;
  messageId?: string;
  memberId: string;
  memberName?: string;
  excerpt?: string;
  reason: string;
}

async function sendReport(input: ReportInput, token: string) {
  const res = await fetch(`${ACCOUNT_API_URL}/v1/report`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, excerpt: input.excerpt?.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`The report didn't go through (${res.status}). Please try again.`);
}

const REASONS = ['Spam', 'Harassment or bullying', 'Hate or violence', 'Sexual content', 'Something else'];

// A plain alert, not ActionSheetIOS (2026-10-20): the report starts from the
// long-press menu, and an action sheet presented while that modal is still
// dismissing crashed the app on device. Alerts present in their own window.
function pickReason(title: string, onPick: (reason: string) => void) {
  Alert.alert(title, 'Why are you reporting this?', [
    ...REASONS.map((r) => ({ text: r, onPress: () => onPick(r) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

/** Report one message: pick a reason, send it, confirm. */
export function reportMessage(opts: { org: string; message: Message; author?: Member; getAccessToken: () => Promise<string> }) {
  const { org, message, author, getAccessToken } = opts;
  pickReason('Report message', (reason) => {
    void getAccessToken()
      .then((token) =>
        sendReport(
          { kind: 'message', org, spaceId: message.spaceId, messageId: message.id, memberId: message.author.memberId, memberName: author?.displayName, excerpt: message.body, reason },
          token,
        ),
      )
      .then(() => Alert.alert('Thanks for reporting', "We'll review this message within 24 hours and remove it if it breaks our rules."))
      .catch((err) => Alert.alert("Couldn't send the report", friendlyError(err)));
  });
}

/** Block someone: confirm, hide them on this phone, and report them to the team. */
export function blockMember(opts: { org: string; member: { id: string; name: string }; spaceId?: string; getAccessToken: () => Promise<string> }) {
  const { org, member, spaceId, getAccessToken } = opts;
  Alert.alert(`Block ${member.name}?`, "You won't see their messages or direct messages. We'll also let our team know so they can review.", [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Block',
      style: 'destructive',
      onPress: () => {
        blocked = { ...blocked, [org]: [...(blocked[org] ?? []).filter((m) => m.id !== member.id), member] };
        save();
        void getAccessToken()
          .then((token) => sendReport({ kind: 'user', org, spaceId, memberId: member.id, memberName: member.name, reason: 'Blocked by user' }, token))
          .catch(() => {});
        Alert.alert(`${member.name} is blocked`, 'You can unblock them in Account → Blocked users.');
      },
    },
  ]);
}
