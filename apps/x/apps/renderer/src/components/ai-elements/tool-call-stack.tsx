"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ToolPermissionRequestEvent } from "@x/shared/src/runs.js";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import z from "zod";

import {
  type PermissionResponse,
  type ToolCall,
  getToolDisplayName,
} from "@/lib/chat-conversation";
import { PermissionRequest } from "./permission-request";

type PermissionScope = "once" | "session" | "always";

export type ToolCallStackProps = ComponentProps<typeof Collapsible> & {
  tools: ToolCall[];
  allPermissionRequests?: Map<string, z.infer<typeof ToolPermissionRequestEvent>>;
  permissionResponses?: Map<string, PermissionResponse>;
  isProcessing?: boolean;
  onPermissionResponse?: (
    toolCallId: string,
    subflow: string[],
    response: PermissionResponse,
    scope?: PermissionScope,
  ) => void;
  renderToolCall: (tool: ToolCall) => ReactNode;
};

const GROUP_PREVIEW_LIMIT = 3;

const getGroupPreview = (tools: ToolCall[]) => {
  const labels = Array.from(new Set(tools.map((tool) => getToolDisplayName(tool))));
  if (labels.length === 0) return "No tool activity";
  if (labels.length <= GROUP_PREVIEW_LIMIT) return labels.join(" • ");
  return `${labels.slice(0, GROUP_PREVIEW_LIMIT).join(" • ")} • +${labels.length - GROUP_PREVIEW_LIMIT} more`;
};

const getGroupStatus = (
  tools: ToolCall[],
  hasPendingPermission: boolean,
): {
  icon: ReactNode;
  label: string;
  className: string;
} => {
  if (hasPendingPermission) {
    return {
      icon: <AlertTriangleIcon className="size-3.5 text-amber-600" />,
      label: "Awaiting approval",
      className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    };
  }

  if (tools.some((tool) => tool.status === "error")) {
    return {
      icon: <XCircleIcon className="size-3.5 text-red-600" />,
      label: "Error",
      className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    };
  }

  if (tools.some((tool) => tool.status === "pending" || tool.status === "running")) {
    return {
      icon: <ClockIcon className="size-3.5 animate-pulse text-blue-600" />,
      label: "Running",
      className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    };
  }

  return {
    icon: <CheckCircleIcon className="size-3.5 text-green-600" />,
    label: "Completed",
    className: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  };
};

export const ToolCallStack = ({
  tools,
  allPermissionRequests = new Map(),
  permissionResponses = new Map(),
  isProcessing = false,
  onPermissionResponse,
  renderToolCall,
  className,
  open,
  onOpenChange,
  ...props
}: ToolCallStackProps) => {
  const hasPendingPermission = tools.some((tool) => {
    if (!allPermissionRequests.has(tool.id)) return false;
    return !permissionResponses.has(tool.id);
  });
  const defaultOpen =
    hasPendingPermission ||
    tools.some((tool) => tool.status === "pending" || tool.status === "running");
  const effectiveOpen = hasPendingPermission || (open ?? defaultOpen);
  const groupStatus = getGroupStatus(tools, hasPendingPermission);

  const handleOpenChange = (nextOpen: boolean) => {
    if (hasPendingPermission && !nextOpen) return;
    onOpenChange?.(nextOpen);
  };

  return (
    <Collapsible
      className={cn(
        "not-prose mb-4 w-full overflow-hidden rounded-xl border bg-background/90 shadow-xs",
        className,
      )}
      open={effectiveOpen}
      onOpenChange={handleOpenChange}
      {...props}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/20">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <WrenchIcon className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">Tool activity</span>
            <Badge variant="secondary" className={cn("gap-1.5 rounded-full text-xs", groupStatus.className)}>
              {groupStatus.icon}
              {groupStatus.label}
            </Badge>
          </div>
          <p className="mt-1 truncate text-muted-foreground text-xs">
            {getGroupPreview(tools)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="rounded-full px-2 py-0 text-xs">
            {tools.length}
          </Badge>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent className="data-[state=closed]:animate-out data-[state=open]:animate-in">
        <div className="border-t bg-muted/10 p-3">
          <div className="space-y-3">
            {tools.map((tool) => {
              const permissionRequest = allPermissionRequests.get(tool.id);
              const response = permissionResponses.get(tool.id) ?? null;
              const renderedTool = renderToolCall(tool);

              if (!renderedTool && !permissionRequest) return null;

              return (
                <div
                  key={tool.id}
                  className={cn(
                    "space-y-3 rounded-lg border bg-background/85 p-3",
                    permissionRequest && !response && "border-amber-300/60",
                  )}
                >
                  {renderedTool}
                  {permissionRequest && onPermissionResponse && (
                    <PermissionRequest
                      className="mb-0"
                      toolCall={permissionRequest.toolCall}
                      onApprove={() => onPermissionResponse(permissionRequest.toolCall.toolCallId, permissionRequest.subflow, "approve")}
                      onApproveSession={() => onPermissionResponse(permissionRequest.toolCall.toolCallId, permissionRequest.subflow, "approve", "session")}
                      onApproveAlways={() => onPermissionResponse(permissionRequest.toolCall.toolCallId, permissionRequest.subflow, "approve", "always")}
                      onDeny={() => onPermissionResponse(permissionRequest.toolCall.toolCallId, permissionRequest.subflow, "deny")}
                      isProcessing={isProcessing}
                      response={response}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
