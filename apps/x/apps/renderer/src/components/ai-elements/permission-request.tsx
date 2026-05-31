"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, RefreshCwIcon, Terminal, XIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import z from "zod";

export type PermissionRequestProps = ComponentProps<"div"> & {
  toolCall: z.infer<typeof ToolCallPart>;
  onApprove?: () => void;
  onApproveSession?: () => void;
  onApproveAlways?: () => void;
  onDeny?: () => void;
  onSwitchAgent?: (newAgent: 'claude' | 'codex') => void;
  isProcessing?: boolean;
  response?: 'approve' | 'deny' | null;
  permission?: z.infer<typeof ToolPermissionMetadata>;
};

const fileActionLabels: Record<string, string> = {
  read: "Read file",
  list: "List folder",
  search: "Search files",
  write: "Write files",
  delete: "Delete path",
};

export const PermissionRequest = ({
  className,
  toolCall,
  onApprove,
  onApproveSession,
  onApproveAlways,
  onDeny,
  onSwitchAgent,
  isProcessing = false,
  response = null,
  permission,
  ...props
}: PermissionRequestProps) => {
  // Extract command from arguments if it's executeCommand
  const command = permission?.kind === "command" || toolCall.toolName === "executeCommand"
    ? (typeof toolCall.arguments === "object" && toolCall.arguments !== null && "command" in toolCall.arguments
        ? String(toolCall.arguments.command)
        : JSON.stringify(toolCall.arguments))
    : null;
  const filePermission = permission?.kind === "file" ? permission : null;

  // Detect acpx coding-agent invocations so we can show the agent identity and
  // offer a one-click swap-and-retry.
  const acpxAgent: 'claude' | 'codex' | null = (() => {
    if (!command) return null;
    const match = command.match(/\bacpx\b[\s\S]*?\b(claude|codex)\b\s+exec\b/);
    return match ? (match[1] as 'claude' | 'codex') : null;
  })();
  const otherAgent: 'claude' | 'codex' | null = acpxAgent === 'claude' ? 'codex' : acpxAgent === 'codex' ? 'claude' : null;
  const agentDisplay = acpxAgent === 'claude' ? 'Claude Code' : acpxAgent === 'codex' ? 'Codex' : null;
  const otherDisplay = otherAgent === 'claude' ? 'Claude Code' : otherAgent === 'codex' ? 'Codex' : null;

  const isResponded = response !== null;
  const isApproved = response === 'approve';

  // Once a response is chosen, collapse the details to just the header.
  // Users can click the header to expand them again.
  const [expanded, setExpanded] = useState(false);
  const showDetails = !isResponded || expanded;

  return (
    <div
      className={cn(
        "not-prose mb-4 w-full rounded-md border",
        isResponded
          ? isApproved
            ? "border-green-500/60 bg-green-200/80 dark:border-green-500/40 dark:bg-green-900/40"
            : "border-[#fa2525]/70 bg-[#fa2525]/30 dark:border-[#fa2525]/60 dark:bg-[#fa2525]/30"
          : "border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20",
        className
      )}
      {...props}
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          {!isResponded && (
            <AlertTriangleIcon className="size-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-2">
            <div
              className={cn("flex items-center gap-2", isResponded && "cursor-pointer select-none")}
              onClick={isResponded ? () => setExpanded((v) => !v) : undefined}
            >
              <div className="flex-1">
                <h3 className="font-semibold text-sm text-foreground">
                  {isResponded ? (isApproved ? "Permission Granted" : "Permission Denied") : "Permission Required"}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {isResponded ? "Requested:" : "The agent wants to execute:"} <span className="font-mono font-medium">{toolCall.toolName}</span>
                  {agentDisplay && (
                    <Badge
                      variant="secondary"
                      className="ml-2 align-middle bg-secondary text-foreground"
                    >
                      <Terminal className="size-3 mr-1" />
                      {agentDisplay}
                    </Badge>
                  )}
                </p>
              </div>
              {isResponded && (
                <ChevronDownIcon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    expanded ? "rotate-180" : "rotate-0"
                  )}
                />
              )}
            </div>
            {showDetails && command && (
              <div className="rounded-md border bg-background/50 p-3 mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Command
                </p>
                <pre className="whitespace-pre-wrap text-xs font-mono text-foreground break-all">
                  {command}
                </pre>
              </div>
            )}
            {showDetails && filePermission && (
              <div className="rounded-md border bg-background/50 p-3 mt-3 space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Action
                  </p>
                  <p className="text-xs font-medium text-foreground">
                    {fileActionLabels[filePermission.operation] ?? filePermission.operation}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Path{filePermission.paths.length === 1 ? "" : "s"}
                  </p>
                  <pre className="whitespace-pre-wrap text-xs font-mono text-foreground break-all">
                    {filePermission.paths.join("\n")}
                  </pre>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Approval Scope
                  </p>
                  <pre className="whitespace-pre-wrap text-xs font-mono text-foreground break-all">
                    {filePermission.pathPrefix}
                  </pre>
                </div>
              </div>
            )}
            {showDetails && !command && !filePermission && toolCall.arguments && (
              <div className="rounded-md border bg-background/50 p-3 mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Arguments
                </p>
                <pre className="whitespace-pre-wrap text-xs font-mono text-foreground break-all">
                  {JSON.stringify(toolCall.arguments, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
        {!isResponded && (
          <div className="flex items-center gap-2 pt-2">
            <div className="flex flex-1 items-center">
              <Button
                variant="default"
                size="sm"
                onClick={onApprove}
                disabled={isProcessing}
                className={cn("flex-1", (command || filePermission) && "rounded-r-none")}
              >
                <CheckIcon className="size-4" />
                Approve
              </Button>
              {(command || filePermission) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={isProcessing}
                      className="rounded-l-none border-l border-l-primary-foreground/20 px-1.5"
                    >
                      <ChevronDownIcon className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onApproveSession}>
                      Allow for Session
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onApproveAlways}>
                      Always Allow
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDeny}
              disabled={isProcessing}
              className="flex-1"
            >
              <XIcon className="size-4" />
              Deny
            </Button>
            {otherAgent && otherDisplay && onSwitchAgent && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onSwitchAgent(otherAgent)}
                disabled={isProcessing}
                className="flex-1"
              >
                <RefreshCwIcon className="size-4" />
                Use {otherDisplay} instead
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
