"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ToolInput, ToolOutput, ToolStatusBadge, type ToolStatus } from "@/components/ai-elements/tool";

export type ToolActivityItem = {
  id: string;
  title: string;
  subtitle?: string;
  state: ToolStatus;
  input: ToolUIPart["input"];
  output: ToolUIPart["output"];
  errorText: ToolUIPart["errorText"];
  extra?: ReactNode;
  defaultOpen?: boolean;
};

function getGroupState(items: ToolActivityItem[]): ToolStatus {
  const states = items.map((i) => i.state);

  if (states.includes("output-error")) return "output-error";
  if (states.includes("output-denied")) return "output-denied";
  if (states.includes("approval-requested")) return "approval-requested";
  if (states.includes("input-available")) return "input-available";
  if (states.includes("input-streaming")) return "input-streaming";
  if (states.includes("approval-responded")) return "approval-responded";
  return "output-available";
}

export type ToolActivityProps = {
  title: string;
  items: ToolActivityItem[];
  className?: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
};

export function ToolActivity({
  title,
  items,
  className,
  defaultOpen = false,
  summary,
}: ToolActivityProps) {
  const groupState = getGroupState(items);

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn("not-prose mb-2 w-full rounded-md border bg-background/50", className)}
    >
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-4 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <WrenchIcon className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-medium text-sm">{title}</span>
              <Badge variant="secondary" className="rounded-full text-xs">
                {items.length} step{items.length === 1 ? "" : "s"}
              </Badge>
              <ToolStatusBadge status={groupState} />
            </div>
            {summary ? (
              <div className="mt-0.5 text-xs text-muted-foreground truncate">{summary}</div>
            ) : null}
          </div>
        </div>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t">
        <div className="divide-y">
          {items.map((item) => (
            <Collapsible key={item.id} className="w-full" defaultOpen={item.defaultOpen}>
              <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2 hover:bg-muted/30">
                <div className="min-w-0">
                  <div className="min-w-0 truncate text-sm">{item.title}</div>
                  {item.subtitle ? (
                    <div className="mt-0.5 min-w-0 truncate text-xs text-muted-foreground font-mono">
                      {item.subtitle}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ToolStatusBadge status={item.state} />
                  <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="bg-background">
                <ToolInput input={item.input ?? {}} className="p-3" />
                <ToolOutput output={item.output} errorText={item.errorText} className="p-3 pt-0" />
                {item.extra ? (
                  <div className="p-3 pt-0">{item.extra}</div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
