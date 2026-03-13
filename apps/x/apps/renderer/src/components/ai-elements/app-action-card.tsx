"use client";

import {
  CheckCircleIcon,
  FileTextIcon,
  FilterIcon,
  LayoutGridIcon,
  LoaderIcon,
  NetworkIcon,
  PlusCircleIcon,
} from "lucide-react";
import type { AppActionCardData } from "@/lib/chat-conversation";

interface AppActionCardProps {
  data: AppActionCardData;
  status: "pending" | "running" | "completed" | "error";
}

const actionIcons: Record<string, React.ReactNode> = {
  "open-note": <FileTextIcon className="size-4" />,
  "open-view": <NetworkIcon className="size-4" />,
  "update-base-view": <FilterIcon className="size-4" />,
  "create-base": <PlusCircleIcon className="size-4" />,
};

export function AppActionCard({ data, status }: AppActionCardProps) {
  const isRunning = status === "pending" || status === "running";
  const isError = status === "error";

  return (
    <div className="not-prose mb-4 flex items-center gap-2 rounded-md border px-3 py-2">
      <span className="text-muted-foreground">
        {actionIcons[data.action] || <LayoutGridIcon className="size-4" />}
      </span>
      <span className="text-sm flex-1">{data.label}</span>
      {isRunning ? (
        <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
      ) : isError ? (
        <span className="text-xs text-destructive">Failed</span>
      ) : (
        <CheckCircleIcon className="size-3.5 text-green-600" />
      )}
    </div>
  );
}
