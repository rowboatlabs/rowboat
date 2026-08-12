"use client";

import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { quietRowContainerClass, quietRowGlyphSlotClass, quietRowTriggerClass } from "@/components/ai-elements/tool";
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
  read: "read",
  list: "list",
  search: "search",
  write: "write to",
  delete: "delete",
};

// Quiet row for an automatic permission decision. In practice only denials
// render here — allowed calls carry a shield glyph on the tool row itself
// (ToolHeader autoApproved) instead of a separate transcript entry.
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
  const [expanded, setExpanded] = useState(false);

  const detail = command
    ? command.split("\n")[0]
    : filePermission
      ? `${fileActionLabels[filePermission.operation] ?? filePermission.operation} ${filePermission.paths[0] ?? filePermission.pathPrefix}`
      : toolCall.toolName;

  return (
    <div className={cn(quietRowContainerClass, className)} {...props}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={quietRowTriggerClass}
      >
        <span className={quietRowGlyphSlotClass}>
          {!allowed && <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-500" />}
        </span>
        <span className={cn("shrink-0 font-medium", allowed ? "text-muted-foreground" : "text-foreground")}>
          {allowed ? "Auto-allowed" : "Auto-denied"}
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{detail}</span>
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3 shrink-0 text-muted-foreground/50 opacity-0 transition-[opacity,transform] group-hover/row:opacity-100",
            expanded && "rotate-180 opacity-100",
          )}
        />
      </button>
      {!allowed && !expanded && (
        <p className="mb-0.5 ml-5 truncate text-xs text-muted-foreground" title={reason}>
          {reason}
        </p>
      )}
      {expanded && (
        <div className="my-1 ml-[2.5px] flex flex-col gap-2 border-l-2 border-border pl-3">
          <div className="min-w-0">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Reason</p>
            <p className="text-xs text-muted-foreground">{reason}</p>
          </div>
          {command && (
            <div className="min-w-0">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">Command</p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">{command}</pre>
            </div>
          )}
          {filePermission && (
            <div className="min-w-0">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Path{filePermission.paths.length === 1 ? "" : "s"}
              </p>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                {filePermission.paths.join("\n")}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
