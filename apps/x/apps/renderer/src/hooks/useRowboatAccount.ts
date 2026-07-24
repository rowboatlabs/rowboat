import { useCallback, useEffect, useState } from 'react';

// Account state only — sign-in status and the access token. The bootstrap
// config (/v1/config: service URLs, billing catalog, model recommendations)
// is deliberately NOT part of this snapshot: it's unauthenticated and
// sign-in independent, so consumers read it from use-rowboat-config instead.
interface RowboatAccountState {
  signedIn: boolean;
  accessToken: string | null;
}

export type RowboatAccountSnapshot = RowboatAccountState;

const DEFAULT_STATE: RowboatAccountState = {
  signedIn: false,
  accessToken: null,
};

export function useRowboatAccount() {
  const [state, setState] = useState<RowboatAccountState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refresh = useCallback(async (): Promise<RowboatAccountSnapshot | null> => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('account:getRowboat', null);
      const next: RowboatAccountSnapshot = {
        signedIn: result.signedIn,
        accessToken: result.accessToken,
      };
      setState(next);
      return next;
    } catch (error) {
      console.error('Failed to load Rowboat account state:', error);
      setState(DEFAULT_STATE);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider !== 'rowboat') {
        return;
      }
      refresh();
    });
    return cleanup;
  }, [refresh]);

  return {
    signedIn: state.signedIn,
    accessToken: state.accessToken,
    isLoading,
    refresh,
  };
}
