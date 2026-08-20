import { useEffect, useRef, useState } from 'react';
import { turnFollower, turns } from '@x/shared';
import { useConnection } from './connection';

// Live view of one turn: the shared turn-follower protocol (snapshot +
// durable splice + gap refetch) over the WS feed, plus a streaming-text
// overlay fed by per-turn delta subscription. The overlay clears whenever the
// durable state catches up (model_call_completed carries the full text).

export interface LiveTurn {
  state: turns.TurnState | null;
  liveText: string;
  error: string | null;
}

export function useLiveTurn(turnId: string | undefined, opts?: { deltas?: boolean }): LiveTurn {
  const { sessions, events } = useConnection();
  const wantDeltas = opts?.deltas ?? true;
  const [state, setState] = useState<turns.TurnState | null>(null);
  const [liveText, setLiveText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const liveTextRef = useRef('');

  useEffect(() => {
    setState(null);
    setLiveText('');
    liveTextRef.current = '';
    setError(null);
    if (!turnId || !sessions || !events) return;

    // Durable events always follow (snapshot + splice); the high-volume
    // text/reasoning delta subscription is opt-in — only the active turn
    // needs it.
    const releaseDeltas = wantDeltas ? events.subscribeTurnDeltas(turnId) : null;
    const offDeltas = events.on('turns:events', (payload) => {
      const e = payload as turns.TurnBusEvent;
      if (e.turnId !== turnId) return;
      if (e.event.type === 'text_delta') {
        liveTextRef.current += e.event.delta ?? '';
        setLiveText(liveTextRef.current);
      } else if (
        e.event.type === 'model_call_completed' ||
        e.event.type === 'turn_completed' ||
        e.event.type === 'turn_failed' ||
        e.event.type === 'turn_cancelled'
      ) {
        liveTextRef.current = '';
        setLiveText('');
      }
    });

    const follower = turnFollower.followTurn(turnId, {
      fetchTurn: (id) => sessions.getTurn(id),
      subscribe: (listener) =>
        events.on('turns:events', (payload) => listener(payload as turns.TurnBusEvent)),
      onState: setState,
      onError: setError,
      onSnapshotFailed: (message) => setError(message),
    });
    const offResync = events.onResync(() => {
      // A reconnect can hide a finished turn forever: if the terminal events
      // fired during the outage, nothing arrives for this turn again and the
      // offset-gap check never trips. Force a fresh snapshot and drop the
      // overlay (the refetched durable text supersedes it).
      liveTextRef.current = '';
      setLiveText('');
      follower.refetch();
    });

    return () => {
      follower.stop();
      offDeltas();
      offResync();
      releaseDeltas?.();
    };
  }, [turnId, sessions, events, wantDeltas]);

  return { state, liveText, error };
}
