import { useEffect, useMemo, useState } from 'react';
import type { Invocation, InvocationActivity } from '@rowboat/spaces-protocol';

import type { SpacesClient } from '@/lib/spaces/client';

// Agent invocations on the phone (Harbor spec §8; mobile parity 2026-11-13):
// what the line under a message says an agent is doing. The screens seed a
// list from listInvocations, fold every `invocation_state` frame into it, and
// read it again on each resubscribe, since those frames are never replayed.
// The fold is the desktop's (renderer use-space-invocations.ts), kept here as
// state the screen owns rather than a module store.

const FINISHED: readonly Invocation['state'][] = ['done', 'failed', 'cancelled', 'refused'];

/** Fold invocations in, keeping whichever copy of each is newer: a slow snapshot must not undo a live frame. */
export function foldInvocations(prev: readonly Invocation[], incoming: readonly Invocation[]): Invocation[] {
  if (incoming.length === 0) return prev as Invocation[];
  const next = new Map(prev.map((i) => [i.id, i]));
  for (const invocation of incoming) {
    const old = next.get(invocation.id);
    const current = old && (FINISHED.includes(old.state) || old.updatedAt > invocation.updatedAt) ? old : invocation;
    if (current.state !== 'working' && current.state !== 'waiting') {
      const { activityHistory: _finished, ...rest } = current;
      next.set(current.id, rest);
      continue;
    }
    // History entries merge by Harbor's monotonic ids, so a late snapshot fills earlier lines without duplicating any.
    const entries = new Map([...(old?.activityHistory ?? []), ...(invocation.activityHistory ?? [])].map((e) => [e.id, e]));
    next.set(current.id, { ...current, activityHistory: [...entries.values()].sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return [...next.values()];
}

/** The live frame as an invocation: its one new activity line rides as a one-entry history. */
export function frameInvocation(frame: { invocation: Invocation; activityEntry?: InvocationActivity }): Invocation {
  return { ...frame.invocation, ...(frame.activityEntry ? { activityHistory: [frame.activityEntry] } : {}) };
}

/** A space's invocations grouped by the message that invoked them, for the rows' lines. */
export function invocationsByMessage(list: readonly Invocation[]): ReadonlyMap<string, Invocation[]> {
  const out = new Map<string, Invocation[]>();
  for (const invocation of list) {
    const group = out.get(invocation.trigger.messageId) ?? [];
    group.push(invocation);
    out.set(invocation.trigger.messageId, group);
  }
  return out;
}

// --- Stop: whether an agent's connector declared it can stop ---------------------

// Cached a minute per agent, as on desktop: a local agent declares more
// seconds after it connects, so a stale "can't stop" must not stick.
const CAPABILITIES_TTL_MS = 60_000;
const canStop = new Map<string, { at: number; stop: boolean }>();
const loading = new Set<string>();

/** Which of these agents can be stopped mid-run. Unknown (still loading, or the fetch failed) reads as no. */
export function useAgentsCanStop(client: SpacesClient, org: string, agentIds: readonly string[]): ReadonlySet<string> {
  const [version, setVersion] = useState(0);
  const idsKey = agentIds.join('|');
  useEffect(() => {
    let alive = true;
    for (const id of agentIds) {
      const key = `${org}/${id}`;
      const cached = canStop.get(key);
      if (loading.has(key) || (cached && Date.now() - cached.at < CAPABILITIES_TTL_MS)) continue;
      loading.add(key);
      client
        .getAgentCapabilities(id)
        .then(({ capabilities }) => {
          canStop.set(key, { at: Date.now(), stop: capabilities.stop === true });
          if (alive) setVersion((v) => v + 1);
        })
        .catch(() => {})
        .finally(() => loading.delete(key));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey stands for agentIds
  }, [client, org, idsKey]);
  return useMemo(
    () => new Set(agentIds.filter((id) => canStop.get(`${org}/${id}`)?.stop === true)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version marks a capability landing
    [org, idsKey, version],
  );
}
