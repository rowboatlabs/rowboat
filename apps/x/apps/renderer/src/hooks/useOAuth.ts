import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/lib/toast';

/**
 * Hook for managing OAuth connection state for a specific provider
 */
export function useOAuth(provider: string) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  const checkConnection = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('oauth:getState', null);
      const config = result.config || {};
      setIsConnected(config[provider]?.connected ?? false);
    } catch (error) {
      console.error('Failed to check connection status:', error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }, [provider]);

    // Check connection status on mount and when provider changes
    useEffect(() => {
      checkConnection();
    }, [provider, checkConnection]);
  
    // Listen for OAuth completion events
    useEffect(() => {
      const cleanup = window.ipc.on('oauth:didConnect', (event) => {
        if (event.provider !== provider) {
          return; // Ignore events for other providers
        }
  
        setIsConnected(event.success);
        setIsConnecting(false);
        setIsLoading(false);
  
        if (event.success) {
          toast(`Successfully connected to ${provider}`, 'success');
          // Refresh connection status to ensure consistency
          checkConnection();
        } else {
          toast(event.error || `Failed to connect to ${provider}`, 'error');
        }
      });
  
      return cleanup;
    }, [provider, checkConnection]);

  const connect = useCallback(async (clientId?: string) => {
    try {
      setIsConnecting(true);
      const result = await window.ipc.invoke('oauth:connect', { provider, clientId });
      if (result.success) {
        // OAuth flow started - keep isConnecting state, wait for event
        // Event listener will handle the actual completion
      } else {
        // Immediate failure (e.g., couldn't start flow)
        toast(result.error || `Failed to connect to ${provider}`, 'error');
        setIsConnecting(false);
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      toast(`Failed to connect to ${provider}`, 'error');
      setIsConnecting(false);
    }
  }, [provider]);

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
      const result = await window.ipc.invoke('oauth:getState', null);
      const config = result.config || {};
      const connected = Object.entries(config)
        .filter(([, value]) => value?.connected)
        .map(([key]) => key);
      setProviders(connected);
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
