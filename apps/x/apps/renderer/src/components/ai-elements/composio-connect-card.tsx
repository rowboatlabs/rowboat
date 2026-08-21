"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircleIcon,
  Link2Icon,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { waitForComposioConnection } from "@/lib/composio-connection";

interface ComposioConnectCardProps {
  toolkitSlug: string;
  toolkitDisplayName: string;
  status: "pending" | "running" | "completed" | "error";
  alreadyConnected?: boolean;
  onConnected?: (toolkitSlug: string) => void;
}

export function ComposioConnectCard({
  toolkitSlug,
  toolkitDisplayName,
  status,
  alreadyConnected,
  onConnected,
}: ComposioConnectCardProps) {
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "connected" | "error"
  >(alreadyConnected ? "connected" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const didFireCallback = useRef(alreadyConnected ?? false);
  const connectionAttempt = useRef(0);

  // Listen for composio:didConnect events
  useEffect(() => {
    const cleanup = window.ipc.on(
      "composio:didConnect",
      (event: { toolkitSlug: string; success: boolean; error?: string }) => {
        if (event.toolkitSlug !== toolkitSlug) return;
        connectionAttempt.current += 1;
        if (event.success) {
          setConnectionState("connected");
          setErrorMessage(null);
          if (!didFireCallback.current) {
            didFireCallback.current = true;
            onConnected?.(toolkitSlug);
          }
        } else {
          setConnectionState("error");
          setErrorMessage(event.error || "Connection failed");
        }
      }
    );
    return cleanup;
  }, [toolkitSlug, onConnected]);

  useEffect(() => () => {
    connectionAttempt.current += 1;
  }, []);

  const handleConnect = useCallback(async () => {
    const attempt = ++connectionAttempt.current;
    setConnectionState("connecting");
    setErrorMessage(null);
    try {
      const result = await window.ipc.invoke("composio:initiate-connection", {
        toolkitSlug,
      });
      if (!result.success) {
        if (connectionAttempt.current !== attempt) return;
        setConnectionState("error");
        setErrorMessage(result.error || "Failed to initiate connection");
        return;
      }

      const outcome = await waitForComposioConnection({
        readStatus: () => window.ipc.invoke("composio:get-connection-status", { toolkitSlug }),
        isCurrent: () => connectionAttempt.current === attempt,
      });
      if (connectionAttempt.current !== attempt) return;

      if (outcome.state === "connected") {
        setConnectionState("connected");
        setErrorMessage(null);
        if (!didFireCallback.current) {
          didFireCallback.current = true;
          onConnected?.(toolkitSlug);
        }
      } else if (outcome.state === "failed") {
        setConnectionState("error");
        setErrorMessage(`Connection status: ${outcome.status}`);
      } else if (outcome.state === "timeout") {
        setConnectionState("error");
        setErrorMessage("Connection timed out");
      }
    } catch {
      if (connectionAttempt.current !== attempt) return;
      setConnectionState("error");
      setErrorMessage("Failed to initiate connection");
    }
  }, [toolkitSlug, onConnected]);

  const isToolRunning = status === "pending" || status === "running";
  const displayName = toolkitDisplayName || toolkitSlug;

  return (
    <div className="not-prose mb-4 flex items-center gap-3 rounded-lg border px-3 py-2.5">
      {/* Toolkit initial */}
      <div className="size-7 rounded bg-muted flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-muted-foreground">
          {displayName.charAt(0).toUpperCase()}
        </span>
      </div>

      {/* Name & status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium truncate">{displayName}</span>
          {connectionState === "connected" && (
            <span className="rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-green-600">
              Connected
            </span>
          )}
        </div>
        {connectionState === "error" && errorMessage && (
          <p className="text-xs text-destructive truncate">{errorMessage}</p>
        )}
        {connectionState === "idle" && isToolRunning && (
          <p className="text-xs text-muted-foreground">Waiting to connect...</p>
        )}
      </div>

      {/* Action area */}
      {connectionState === "connected" ? (
        <CheckCircleIcon className="size-4 text-green-600 flex-shrink-0" />
      ) : connectionState === "connecting" ? (
        <Button size="sm" disabled className="text-xs h-7 flex-shrink-0">
          <LoaderIcon className="size-3 animate-spin mr-1" />
          Connecting...
        </Button>
      ) : connectionState === "error" ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <XCircleIcon className="size-3.5 text-destructive" />
          <Button size="sm" variant="outline" onClick={handleConnect} className="text-xs h-7">
            Retry
          </Button>
        </div>
      ) : isToolRunning ? (
        <LoaderIcon className="size-3.5 animate-spin text-muted-foreground flex-shrink-0" />
      ) : (
        <Button size="sm" onClick={handleConnect} className="text-xs h-7 flex-shrink-0">
          <Link2Icon className="size-3 mr-1" />
          Connect
        </Button>
      )}
    </div>
  );
}
