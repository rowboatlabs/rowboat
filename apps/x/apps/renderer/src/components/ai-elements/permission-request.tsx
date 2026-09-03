"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { quietRowContainerClass, quietRowGlyphSlotClass, quietRowTriggerClass } from "@/components/ai-elements/tool";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import z from "zod";

export type PermissionRequestProps = ComponentProps<"div"> & {
  toolCall: z.infer<typeof ToolCallPart>;
  onApprove?: () => void;
  onApproveSession?: () => void;
  onApproveAlways?: () => void;
  onDeny?: () => void;
  isProcessing?: boolean;
  response?: 'approve' | 'deny' | null;
  permission?: z.infer<typeof ToolPermissionMetadata>;
};

const fileActionLabels: Record<string, string> = {
  read: "Read",
  list: "List",
  search: "Search",
  write: "Write to",
  delete: "Delete",
};

const truncateMiddle = (value: string, max = 64): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}…`;
};

const DetailSection = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <p className="mb-0.5 text-[13px] text-muted-foreground">
      {label}
    </p>
    <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
      {children}
    </pre>
  </div>
);

export const PermissionRequest = ({
  className,
  toolCall,
  onApprove,
  onApproveSession,
  onApproveAlways,
  onDeny,
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
  const externalAction =
    permission?.kind === "composio"
      ? { label: "Composio action", detail: `${permission.toolSlug} (${permission.toolkitSlug})` }
      : permission?.kind === "mcp"
        ? {
            label: "MCP tool",
            detail: permission.serverName
              ? `${permission.toolName} on ${permission.serverName}`
              : permission.toolName,
          }
        : null;

  const isResponded = response !== null;
  const isApproved = response === 'approve';

  // Scope actions ("Allow for Session"/"Always Allow") render only when the
  // caller wires them: the legacy code-mode path persists grants, but the
  // turns path has no grant persistence yet and must not show dead buttons.
  const hasScopeActions =
    Boolean(onApproveSession || onApproveAlways) &&
    Boolean(command || filePermission);

  // Once a response is chosen the ask collapses to a quiet one-line row;
  // clicking it re-expands the request details.
  const [expanded, setExpanded] = useState(false);

  // One-line ask: "Run `npm test`?" / "Write to `~/notes/plan.md`?"
  const summary: ReactNode = command ? (
    <>Run <code className="rounded bg-muted px-1 py-px font-mono text-xs">{truncateMiddle(command)}</code>?</>
  ) : filePermission ? (
    <>
      {fileActionLabels[filePermission.operation] ?? filePermission.operation}{" "}
      <code className="rounded bg-muted px-1 py-px font-mono text-xs">
        {truncateMiddle(filePermission.paths[0] ?? filePermission.pathPrefix)}
      </code>
      {filePermission.paths.length > 1 && ` +${filePermission.paths.length - 1} more`}?
    </>
  ) : externalAction ? (
    <>Use <code className="rounded bg-muted px-1 py-px font-mono text-xs">{truncateMiddle(externalAction.detail)}</code>?</>
  ) : (
    <>Run <code className="rounded bg-muted px-1 py-px font-mono text-xs">{toolCall.toolName}</code>?</>
  );

  const details = (
    <div className="flex flex-col gap-2">
      {command && <DetailSection label="Command">{command}</DetailSection>}
      {filePermission && (
        <>
          <DetailSection label={`Path${filePermission.paths.length === 1 ? "" : "s"}`}>
            {filePermission.paths.join("\n")}
          </DetailSection>
          <DetailSection label="Approval scope">{filePermission.pathPrefix}</DetailSection>
        </>
      )}
      {externalAction && <DetailSection label={externalAction.label}>{externalAction.detail}</DetailSection>}
      {!command && !filePermission && toolCall.arguments != null && (
        <DetailSection label="Arguments">{JSON.stringify(toolCall.arguments, null, 2)}</DetailSection>
      )}
    </div>
  );

  if (isResponded) {
    return (
      <div className={cn(quietRowContainerClass, className)} {...props}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={quietRowTriggerClass}
        >
          <span className={quietRowGlyphSlotClass}>
            {!isApproved && <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-500" />}
          </span>
          <span className="shrink-0 font-medium text-muted-foreground">
            {isApproved ? "Allowed" : "Denied"}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
          <ChevronDownIcon
            className={cn(
              "ml-auto size-3 shrink-0 text-muted-foreground/50 opacity-0 transition-[opacity,transform] group-hover/row:opacity-100",
              expanded && "rotate-180 opacity-100",
            )}
          />
        </button>
        {expanded && <div className="my-1 ml-[2.5px] border-l-2 border-border pl-3">{details}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "not-prose my-1 w-full rounded-[10px] border border-l-2 border-l-amber-500/70 px-3 py-2 text-[13px]",
        className
      )}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <ShieldQuestionIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="min-w-0 flex-1 cursor-pointer truncate text-left"
          title="Show request details"
        >
          {summary}
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="flex items-center">
            <Button
              variant="default"
              size="sm"
              onClick={onApprove}
              disabled={isProcessing}
              className={cn("h-7 rounded-full px-3 text-xs", hasScopeActions && "rounded-r-none")}
            >
              <CheckIcon className="size-3.5" />
              Allow
            </Button>
            {hasScopeActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={isProcessing}
                    className="h-7 rounded-l-none rounded-r-full border-l border-l-primary-foreground/20 px-1.5"
                  >
                    <ChevronDownIcon className="size-3" />
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
            variant="outline"
            size="sm"
            onClick={onDeny}
            disabled={isProcessing}
            className="h-7 rounded-full px-3 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-500"
          >
            <XIcon className="size-3.5" />
            Deny
          </Button>
        </div>
      </div>
      {expanded && <div className="mt-2 border-t pt-2">{details}</div>}
    </div>
  );
};
