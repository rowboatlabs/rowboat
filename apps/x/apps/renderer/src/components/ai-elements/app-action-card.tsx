"use client";

import {
  FileTextIcon,
  FilterIcon,
  LayoutGridIcon,
  LoaderIcon,
  NetworkIcon,
  PlusCircleIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { quietRowGlyphSlotClass } from "@/components/ai-elements/tool";
import type { AppActionCardData } from "@/lib/chat-conversation";

interface AppActionCardProps {
  data: AppActionCardData;
  status: "pending" | "running" | "completed" | "error";
}

const actionIcons: Record<string, React.ReactNode> = {
  "open-note": <FileTextIcon className="size-3.5" />,
  "open-view": <NetworkIcon className="size-3.5" />,
  "update-base-view": <FilterIcon className="size-3.5" />,
  "create-base": <PlusCircleIcon className="size-3.5" />,
};

// Quiet one-line row matching the tool rows: spinner while running, then the
// label fades to muted. Not expandable — the label is the whole story.
export function AppActionCard({ data, status }: AppActionCardProps) {
  const isRunning = status === "pending" || status === "running";
  const isError = status === "error";

  return (
    <div className="not-prose -my-3 flex w-full items-center gap-2 px-1.5 py-[3px] -mx-1.5 text-[13px] leading-5">
      <span className={quietRowGlyphSlotClass}>
        {isRunning ? (
          <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
        ) : isError ? (
          <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-500" />
        ) : null}
      </span>
      <span className="shrink-0 text-muted-foreground">
        {actionIcons[data.action] || <LayoutGridIcon className="size-3.5" />}
      </span>
      <span className={cn("min-w-0 truncate", isRunning ? "text-foreground" : "text-muted-foreground")}>
        {data.label}
      </span>
      {isError && <span className="shrink-0 text-xs text-red-600 dark:text-red-500">failed</span>}
    </div>
  );
}
