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

    const stopFollowing = turnFollower.followTurn(turnId, {
      fetchTurn: (id) => sessions.getTurn(id),
      subscribe: (listener) =>
        events.on('turns:events', (payload) => listener(payload as turns.TurnBusEvent)),
      onState: setState,
      onError: setError,
      onSnapshotFailed: (message) => setError(message),
    });
    const offResync = events.onResync(() => {
      // followTurn refetches on offset gaps by itself; a transport-level
      // resync only needs the overlay cleared (durable text re-converges).
      liveTextRef.current = '';
      setLiveText('');
    });

    return () => {
      stopFollowing();
      offDeltas();
      offResync();
      releaseDeltas?.();
    };
  }, [turnId, sessions, events, wantDeltas]);

  return { state, liveText, error };
}
