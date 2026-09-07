import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

// "Sign in with Google" → Antigravity gateway state. Mirror of useChatGPT.ts
// against the antigravity:* IPC surface: status is fetched on mount and
// re-derived from action results (antigravity:signIn resolves with the final
// status).

type AntigravityStatus = {
  signedIn: boolean;
  email?: string;
};

export function useAntigravity() {
  const [status, setStatus] = useState<AntigravityStatus>({ signedIn: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  // Cancelled flag + attempt sequence: a cancelled or superseded attempt's
  // invoke still resolves later; only the CURRENT attempt may touch
  // isSigningIn or show toasts.
  const cancelledRef = useRef(false);
  const attemptSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setStatus(await window.ipc.invoke('antigravity:getStatus', null));
    } catch (error) {
      console.error('Failed to fetch Antigravity status:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (isSigningIn) return;
    const attempt = ++attemptSeqRef.current;
    cancelledRef.current = false;
    setIsSigningIn(true);
    const isCurrent = () => attempt === attemptSeqRef.current && !cancelledRef.current;
    try {
      const result = await window.ipc.invoke('antigravity:signIn', null);
      if (result.signedIn) {
        setStatus({
          signedIn: true,
          ...(result.email ? { email: result.email } : {}),
        });
        if (isCurrent()) {
          toast.success(result.email ? `Signed in as ${result.email}` : 'Signed in with Google');
        }
      } else if (isCurrent() && !result.cancelled) {
        toast.error(result.error || 'Antigravity sign-in failed');
      }
    } catch (error) {
      console.error('Antigravity sign-in failed:', error);
      if (isCurrent()) {
        toast.error('Antigravity sign-in failed');
      }
    } finally {
      if (isCurrent()) {
        setIsSigningIn(false);
      }
    }
  }, [isSigningIn]);

  const cancelSignIn = useCallback(() => {
    cancelledRef.current = true;
    setIsSigningIn(false);
    window.ipc.invoke('antigravity:cancelSignIn', null).catch((error) => {
      console.error('Failed to cancel Antigravity sign-in:', error);
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('antigravity:signOut', null);
      if (result.success) {
        setStatus({ signedIn: false });
        toast.success('Signed out of Antigravity');
      } else {
        toast.error('Failed to sign out of Antigravity');
      }
    } catch (error) {
      console.error('Antigravity sign-out failed:', error);
      toast.error('Failed to sign out of Antigravity');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    status,
    isLoading,
    isSigningIn,
    signIn,
    cancelSignIn,
    signOut,
    refresh,
  };
}
