import { useState, useEffect, useCallback } from 'react';

interface RowboatAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  isLoggingIn: boolean;
  user: { email: string; name?: string } | null;
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useRowboatAuth(): RowboatAuthState {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    async function checkStatus() {
      try {
        const result = await window.ipc.invoke('auth:getStatus', null);
        setIsAuthenticated(result.isAuthenticated);
        setUser(result.user);
      } catch (err) {
        console.error('Failed to check auth status:', err);
        setIsAuthenticated(false);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }
    checkStatus();
  }, []);

  // Listen for auth events
  useEffect(() => {
    const cleanup = window.ipc.on('auth:didAuthenticate', (event) => {
      setIsAuthenticated(event.isAuthenticated);
      setUser(event.user);
      setIsLoggingIn(false);
      setError(null);
    });
    return cleanup;
  }, []);

  // Also listen for oauth:didConnect for the rowboat provider (handles errors)
  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider !== 'rowboat') return;
      if (!event.success) {
        setIsLoggingIn(false);
        setError(event.error || 'Login failed');
      }
    });
    return cleanup;
  }, []);

  const login = useCallback(async () => {
    try {
      setIsLoggingIn(true);
      setError(null);
      const result = await window.ipc.invoke('auth:login', null);
      if (!result.success) {
        setIsLoggingIn(false);
        setError(result.error || 'Failed to start login');
      }
      // If success, the OAuth flow has started - wait for auth:didAuthenticate event
    } catch (err) {
      console.error('Login failed:', err);
      setIsLoggingIn(false);
      setError('Failed to start login');
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await window.ipc.invoke('auth:logout', null);
      setIsAuthenticated(false);
      setUser(null);
    } catch (err) {
      console.error('Logout failed:', err);
    }
  }, []);

  return {
    isAuthenticated,
    isLoading,
    isLoggingIn,
    user,
    error,
    login,
    logout,
  };
}
