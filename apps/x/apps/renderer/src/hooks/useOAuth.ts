import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/lib/toast';

/**
 * Hook for managing OAuth connection state for a specific provider
 */
export function useOAuth(provider: string) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Check connection status on mount and when provider changes
  useEffect(() => {
    checkConnection();
  }, [provider]);

  const checkConnection = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('oauth:is-connected', { provider });
      setIsConnected(result.isConnected);
    } catch (error) {
      console.error('Failed to check connection status:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

  const connect = useCallback(async () => {
    try {
      setIsConnecting(true);
      const result = await window.ipc.invoke('oauth:connect', { provider });
      if (result.success) {
        toast(`Successfully connected to ${provider}`, 'success');
        await checkConnection();
      } else {
        toast(result.error || `Failed to connect to ${provider}`, 'error');
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      toast(`Failed to connect to ${provider}`, 'error');
    } finally {
      setIsConnecting(false);
    }
  }, [provider, checkConnection]);

  const disconnect = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('oauth:disconnect', { provider });
      if (result.success) {
        toast(`Disconnected from ${provider}`, 'success');
        setIsConnected(false);
      } else {
        toast(`Failed to disconnect from ${provider}`, 'error');
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
      toast(`Failed to disconnect from ${provider}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

  return {
    isConnected,
    isLoading,
    isConnecting,
    connect,
    disconnect,
    refresh: checkConnection,
  };
}

/**
 * Hook to get list of connected providers
 */
export function useConnectedProviders() {
  const [providers, setProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('oauth:get-connected-providers', null);
      setProviders(result.providers);
    } catch (error) {
      console.error('Failed to get connected providers:', error);
      setProviders([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { providers, isLoading, refresh };
}

/**
 * Hook to get list of available providers
 */
export function useAvailableProviders() {
  const [providers, setProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function load() {
      try {
        setIsLoading(true);
        const result = await window.ipc.invoke('oauth:list-providers', null);
        setProviders(result.providers);
      } catch (error) {
        console.error('Failed to get available providers:', error);
        setProviders([]);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return { providers, isLoading };
}

