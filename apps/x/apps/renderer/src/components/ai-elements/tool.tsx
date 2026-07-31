"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import { ChevronDownIcon, LoaderIcon, ShieldCheckIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, isValidElement, useEffect, useRef, useState } from "react";
import type { ToolCall, ToolGroup as ToolGroupType, ToolRowSummary } from "@/lib/chat-conversation";
import { getToolActionsSummary, getToolErrorText, getToolRowSummary, toToolState } from "@/lib/chat-conversation";

const formatToolValue = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value ?? null, null, 2);
    return json ?? "";
  } catch {
    return String(value);
  }
};

/* ── Quiet tool rows ─────────────────────────────────────────────────
 * A tool call is one borderless 13px line: status glyph, medium-weight
 * verb, muted detail, faint trailing stat. The whole row is the expand
 * trigger; a settled row leads with the expand chevron (down collapsed,
 * up while open — same as the group header), while running/failed rows
 * keep a hover-revealed trailing chevron. Completed rows fade to muted
 * so a finished read is unremarkable and a failure stands out.
 *
 * Every quiet surface in the transcript (generic tools, web search,
 * permissions, app actions) shares these two classes so the row look is
 * defined once. Custom surfaces compose them instead of re-deriving.
 */

// Outer wrapper: negative margins pull adjacent rows through the
// conversation's gap-8 so consecutive tool lines pack tightly; nested
// contexts (group children, compact panels) override with my-0.
export const quietRowContainerClass = "not-prose -my-3 w-full";

// The one-line row itself (also the collapse trigger where clickable).
export const quietRowTriggerClass =
  "group/row -mx-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-[3px] text-left text-[13px] leading-5 hover:bg-muted/50";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, children, ...props }: ToolProps) => (
  <Collapsible className={cn(quietRowContainerClass, className)} {...props}>
    {children}
  </Collapsible>
);

// Fixed-width glyph slot so the verb column doesn't shift as a row moves
// through running → settled. Shared by the custom quiet surfaces too.
export const quietRowGlyphSlotClass = "flex size-3 shrink-0 items-center justify-center";

// Lead glyph: spinner while running, a red dot on failure, and — once done —
// the same expand chevron the settled tool-group header uses (down collapsed,
// up while open), so the slot never reads as a hole where the spinner was.
const ToolLeadGlyph = ({ state }: { state: ToolUIPart["state"] }) => (
  <span className={quietRowGlyphSlotClass}>
    {state === "output-error" ? (
      <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-500" />
    ) : state === "output-available" ? (
      <ChevronDownIcon className="size-3 text-muted-foreground/50 transition-transform group-data-[state=open]/row:rotate-180" />
    ) : (
      <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
    )}
  </span>
);

export type ToolHeaderProps = {
  /** Plain title (legacy callers); prefer `summary` for structured rows. */
  title?: string;
  summary?: ToolRowSummary;
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
  /** Hide the leading status glyph (nested rows that carry their own). */
  hideLeadIcon?: boolean;
  /** Shield glyph + reason tooltip for auto-approved permission calls. */
  autoApproved?: { reason: string };
  /** First line of the error, rendered inline under the row (no click needed). */
  errorLine?: string;
};

export const ToolHeader = ({
  className,
  title,
  summary,
  type,
  state,
  hideLeadIcon,
  autoApproved,
  errorLine,
  ...props
}: ToolHeaderProps) => {
  const row: ToolRowSummary = summary ?? { verb: title ?? type.split("-").slice(1).join("-") };
  const done = state === "output-available";
  const failed = state === "output-error";
  const hoverTitle = [row.verb, row.dimPrefix, row.detail, row.stat].filter(Boolean).join(" ");

  return (
    <>
      <CollapsibleTrigger
        className={cn(quietRowTriggerClass, className)}
        title={hoverTitle}
        {...props}
      >
        {!hideLeadIcon && <ToolLeadGlyph state={state} />}
        <span
          className={cn(
            "shrink-0 font-medium",
            done ? "text-muted-foreground" : "text-foreground",
            failed && "text-foreground",
            row.verbMono && "font-mono text-xs"
          )}
        >
          {row.verb}
        </span>
        {(row.detail || row.dimPrefix) && (
          <span
            className={cn(
              "min-w-0 truncate text-muted-foreground",
              row.detailMono && "font-mono text-xs"
            )}
          >
            {row.dimPrefix && <span className="text-muted-foreground/50">{row.dimPrefix}</span>}
            {row.detail}
          </span>
        )}
        {row.diff && (row.diff.added > 0 || row.diff.removed > 0) && (
          <span className="shrink-0 font-mono text-xs tabular-nums">
            <span className="text-green-600 dark:text-green-500">+{row.diff.added}</span>{" "}
            <span className="text-red-600 dark:text-red-500">-{row.diff.removed}</span>
          </span>
        )}
        {row.stat && (
          <span className={cn("shrink-0 tabular-nums", failed ? "text-red-600 dark:text-red-500" : "text-muted-foreground/60")}>
            {row.stat}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {autoApproved && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ShieldCheckIcon className="size-3 text-muted-foreground/50" />
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="max-w-sm">
                Auto-approved: {autoApproved.reason}
              </TooltipContent>
            </Tooltip>
          )}
          {(hideLeadIcon || !done) && (
            <ChevronDownIcon className="size-3 text-muted-foreground/50 opacity-0 transition-[opacity,transform] group-hover/row:opacity-100 group-data-[state=open]/row:rotate-180 group-data-[state=open]/row:opacity-100" />
          )}
        </span>
      </CollapsibleTrigger>
      {failed && errorLine && (
        <p className="mb-0.5 ml-5 truncate font-mono text-xs text-red-600 dark:text-red-500" title={errorLine}>
          {errorLine}
        </p>
      )}
    </>
  );
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

// Expanded detail hangs off a hairline left rule, aligned under the glyph.
export const ToolContent = ({ className, children, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "overflow-hidden text-popover-foreground outline-none data-[state=open]:animate-[collapsible-down_0.09s_ease-out] data-[state=closed]:animate-[collapsible-up_0.08s_ease-in]",
      className
    )}
    {...props}
  >
    <div className="my-1 ml-[2.5px] border-l-2 border-border pl-3">{children}</div>
  </CollapsibleContent>
);

/* ── Expanded parameters / result ────────────────────────────────── */

export type ToolIODetailsProps = {
  input: ToolUIPart["input"];
  output: ToolUIPart["output"];
  errorText?: ToolUIPart["errorText"];
};

const ToolIOSection = ({ label, children, error }: { label: string; children: ReactNode; error?: boolean }) => (
  <div className="min-w-0">
    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
      {label}
    </p>
    <div
      className={cn(
        "max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs",
        error ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {children}
    </div>
  </div>
);

export const ToolIODetails = ({ input, output, errorText }: ToolIODetailsProps) => {
  const hasOutput = output != null || !!errorText;

  let outputNode: ReactNode = null;
  if (errorText) {
    outputNode = errorText;
  } else if (output != null) {
    if (typeof output === "object" && !isValidElement(output)) {
      outputNode = formatToolValue(output);
    } else if (typeof output === "string") {
      outputNode = output;
    } else {
      outputNode = <div>{output as ReactNode}</div>;
    }
  }

  return (
    <div className="flex flex-col gap-2 py-0.5">
      <ToolIOSection label="Parameters">{formatToolValue(input ?? {}) || "(empty)"}</ToolIOSection>
      {hasOutput ? (
        <ToolIOSection label={errorText ? "Error" : "Result"} error={!!errorText}>
          {outputNode}
        </ToolIOSection>
      ) : (
        <ToolIOSection label="Result">(pending...)</ToolIOSection>
      )}
    </div>
  );
};

/* ── Tool group ──────────────────────────────────────────────────────
 * Consecutive plain tool calls share one collapsible header row. While
 * the turn streams the children stay visible so per-tool labels are
 * readable in real time; the group auto-collapses once every call has
 * settled (and loads collapsed from history).
 */

export type ToolGroupProps = {
  group: ToolGroupType;
  isToolOpen: (toolId: string) => boolean;
  onToolOpenChange: (toolId: string, open: boolean) => void;
  /** Auto-approved permission info for a child row's shield glyph. */
  getAutoApproved?: (toolId: string) => { reason: string } | undefined;
};

const getGroupState = (tools: ToolCall[]): ToolUIPart["state"] => {
  if (tools.some((t) => t.status === "error")) return "output-error";
  if (tools.some((t) => t.status === "running")) return "input-available";
  if (tools.some((t) => t.status === "pending")) return "input-streaming";
  return "output-available";
};

export const ToolGroupComponent = ({ group, isToolOpen, onToolOpenChange, getAutoApproved }: ToolGroupProps) => {
  const state = getGroupState(group.items);
  const isCompleted = state === "output-available" || state === "output-error";
  // Live groups start expanded; history-loaded (already settled) start closed.
  const [open, setOpen] = useState(!isCompleted);
  const wasCompleted = useRef(isCompleted);
  useEffect(() => {
    if (!wasCompleted.current && isCompleted) setOpen(false);
    wasCompleted.current = isCompleted;
  }, [isCompleted]);

  const toolCount = group.items.length;
  const summaryText = isCompleted
    ? `Ran ${toolCount} tool${toolCount !== 1 ? "s" : ""}`
    : `Running ${toolCount} tool${toolCount !== 1 ? "s" : ""}…`;
  const actions = isCompleted ? getToolActionsSummary(group.items) : "";

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={quietRowContainerClass}>
      <CollapsibleTrigger
        className={quietRowTriggerClass}
        title={actions ? `${summaryText} · ${actions}` : summaryText}
      >
        {isCompleted ? (
          <ChevronDownIcon
            className={cn("size-3 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-180")}
          />
        ) : (
          <LoaderIcon className="size-3 shrink-0 animate-spin text-muted-foreground" />
        )}
        <span className={cn("shrink-0 font-medium", isCompleted ? "text-muted-foreground" : "text-foreground")}>
          {summaryText}
        </span>
        {actions && <span className="min-w-0 truncate text-muted-foreground/60">· {actions}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[collapsible-down_0.09s_ease-out] data-[state=closed]:animate-[collapsible-up_0.08s_ease-in]">
        <div className="ml-[5px] flex flex-col border-l border-border/70 pl-2.5">
          {group.items.map((tool) => {
            const toolState = toToolState(tool.status);
            const isOpen = isToolOpen(tool.id);
            const errorText = getToolErrorText(tool);
            return (
              <Tool key={tool.id} open={isOpen} onOpenChange={(o) => onToolOpenChange(tool.id, o)} className="my-0">
                <ToolHeader
                  summary={getToolRowSummary(tool)}
                  type={`tool-${tool.name}`}
                  state={toolState}
                  autoApproved={getAutoApproved?.(tool.id)}
                  errorLine={errorText?.split("\n")[0]}
                />
                <ToolContent>
                  <ToolIODetails
                    input={tool.input as ToolUIPart["input"]}
                    output={tool.result as ToolUIPart["output"]}
                    errorText={errorText}
                  />
                </ToolContent>
              </Tool>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
