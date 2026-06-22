"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2Icon, ShieldAlertIcon, Terminal } from "lucide-react";
import type { ComponentProps } from "react";
import { ToolCallPart } from "@x/shared/dist/message.js";
import { ToolPermissionMetadata } from "@x/shared/dist/runs.js";
import z from "zod";

export type AutoPermissionDecisionProps = ComponentProps<"div"> & {
  toolCall: z.infer<typeof ToolCallPart>;
  decision: "allow" | "deny";
  reason: string;
  permission?: z.infer<typeof ToolPermissionMetadata>;
};

const fileActionLabels: Record<string, string> = {
  read: "Read file",
  list: "List folder",
  search: "Search files",
  write: "Write files",
  delete: "Delete path",
};

export function AutoPermissionDecision({
  className,
  toolCall,
  decision,
  reason,
  permission,
  ...props
}: AutoPermissionDecisionProps) {
  const command = permission?.kind === "command" || toolCall.toolName === "executeCommand"
    ? (typeof toolCall.arguments === "object" && toolCall.arguments !== null && "command" in toolCall.arguments
        ? String(toolCall.arguments.command)
        : JSON.stringify(toolCall.arguments))
    : null;
  const filePermission = permission?.kind === "file" ? permission : null;
  const allowed = decision === "allow";

  return (
    <div
      className={cn(
        "not-prose mb-4 w-full rounded-md border",
        allowed
          ? "border-green-500/50 bg-green-50/80 dark:border-green-500/35 dark:bg-green-950/30"
          : "border-[#fa2525]/60 bg-[#fa2525]/15 dark:border-[#fa2525]/50 dark:bg-[#fa2525]/20",
        className,
      )}
      {...props}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          {allowed ? (
            <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-green-600 dark:text-green-400" />
          ) : (
            <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {allowed ? "Auto Allowed" : "Auto Denied"}
              </h3>
              <Badge variant="secondary" className="bg-secondary text-foreground">
                <Terminal className="mr-1 size-3" />
                {toolCall.toolName}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{reason}</p>
          </div>
        </div>
        {command && (
          <div className="rounded-md border bg-background/50 p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Command</p>
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">{command}</pre>
          </div>
        )}
        {filePermission && (
          <div className="space-y-3 rounded-md border bg-background/50 p-3">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Action</p>
              <p className="text-xs font-medium text-foreground">
                {fileActionLabels[filePermission.operation] ?? filePermission.operation}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Path{filePermission.paths.length === 1 ? "" : "s"}
              </p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                {filePermission.paths.join("\n")}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
