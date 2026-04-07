import { z } from 'zod';
import { useCallback, useEffect, useState } from 'react';
import { RowboatApiConfig } from '@x/shared/dist/rowboat-account.js';


interface RowboatAccountState {
  signedIn: boolean;
  accessToken: string | null;
  config: z.infer<typeof RowboatApiConfig> | null;
}

export type RowboatAccountSnapshot = RowboatAccountState;

const DEFAULT_STATE: RowboatAccountState = {
  signedIn: false,
  accessToken: null,
  config: null,
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
        config: result.config,
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
    config: state.config,
    isLoading,
    refresh,
  };
}
