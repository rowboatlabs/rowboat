import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

// "Sign in with ChatGPT" state, modeled on useOAuth.ts but against the
// dedicated chatgpt:* IPC surface: status is fetched on mount and re-derived
// from action results (chatgpt:signIn resolves with the final status — no
// broadcast event to listen for).

type ChatGPTStatus = {
  signedIn: boolean;
  email?: string;
  accountId?: string;
};

export function useChatGPT() {
  const [status, setStatus] = useState<ChatGPTStatus>({ signedIn: false });
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  // Cancelled flag + attempt sequence: a cancelled or superseded attempt's
  // invoke still resolves later (main settles it with `cancelled: true`);
  // only the CURRENT attempt may touch isSigningIn or show toasts, so a
  // stale resolution can't clobber a fresh attempt's waiting UI.
  const cancelledRef = useRef(false);
  const attemptSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      setStatus(await window.ipc.invoke('chatgpt:getStatus', null));
    } catch (error) {
      console.error('Failed to fetch ChatGPT status:', error);
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
    // True only for the attempt whose result should drive the UI.
    const isCurrent = () => attempt === attemptSeqRef.current && !cancelledRef.current;
    try {
      const result = await window.ipc.invoke('chatgpt:signIn', null);
      if (result.signedIn) {
        // Always reflect a successful sign-in, even if this attempt was
        // cancelled client-side after the browser flow completed.
        setStatus({
          signedIn: true,
          ...(result.email ? { email: result.email } : {}),
          ...(result.accountId ? { accountId: result.accountId } : {}),
        });
        if (isCurrent()) {
          toast.success(result.email ? `Signed in as ${result.email}` : 'Signed in with ChatGPT');
        }
      } else if (isCurrent() && !result.cancelled) {
        toast.error(result.error || 'ChatGPT sign-in failed');
      }
    } catch (error) {
      console.error('ChatGPT sign-in failed:', error);
      if (isCurrent()) {
        toast.error('ChatGPT sign-in failed');
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
    // Really abort the main-process attempt (stops the loopback server and
    // settles the pending signIn invoke) — otherwise the next Sign In click
    // would join a dead attempt and never re-open the browser.
    window.ipc.invoke('chatgpt:cancelSignIn', null).catch((error) => {
      console.error('Failed to cancel ChatGPT sign-in:', error);
    });
  }, []);

  const signOut = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke('chatgpt:signOut', null);
      if (result.success) {
        setStatus({ signedIn: false });
        toast.success('Signed out of ChatGPT');
      } else {
        toast.error('Failed to sign out of ChatGPT');
      }
    } catch (error) {
      console.error('ChatGPT sign-out failed:', error);
      toast.error('Failed to sign out of ChatGPT');
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
