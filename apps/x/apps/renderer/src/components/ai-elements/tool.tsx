"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  ChevronDownIcon,
  CircleCheck,
  LoaderIcon,
  XCircleIcon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, isValidElement, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ToolCall, ToolGroup as ToolGroupType } from "@/lib/chat-conversation";
import { getToolActionsSummary, getToolDisplayName, getToolGroupSummary, toToolState } from "@/lib/chat-conversation";

const formatToolValue = (value: unknown) => {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value ?? null, null, 2);
    return json ?? "";
  } catch {
    return String(value);
  }
};

const ToolCode = ({
  code,
  className,
}: {
  code: string;
  className?: string;
}) => (
  <pre
    className={cn(
      "whitespace-pre-wrap text-xs font-mono break-all",
      className
    )}
  >
    {code || "(empty)"}
  </pre>
);

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn(
      "not-prose mb-4 w-full rounded-[28px] border bg-[var(--card-surface)] transition-colors duration-150 ease-out hover:border-foreground/30",
      className
    )}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
  /** Hide the leading status icon (used for child rows inside a tool group). */
  hideLeadIcon?: boolean;
};

// Lead icon shown to the left of the tool label: spinner while running, a
// green check when done, a red cross on error. Shared by ToolHeader (single
// tools) and the tool-call group.
const getLeadIcon = (state: ToolUIPart["state"]): ReactNode => {
  if (state === "output-available") return <CircleCheck className="size-4 shrink-0 text-green-600" />;
  if (state === "output-error") return <XCircleIcon className="size-4 shrink-0 text-red-600" />;
  return <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />;
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  hideLeadIcon,
  ...props
}: ToolHeaderProps) => {
  const displayTitle = title ?? type.split("-").slice(1).join("-")

  return (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!hideLeadIcon && getLeadIcon(state)}
        <span
          className="min-w-0 flex-1 truncate text-left font-medium text-sm"
          title={displayTitle}
        >
          {displayTitle}
        </span>
      </div>
      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  )
};

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "overflow-hidden text-popover-foreground outline-none data-[state=open]:animate-[collapsible-down_0.09s_ease-out] data-[state=closed]:animate-[collapsible-up_0.08s_ease-in]",
      className
    )}
    {...props}
  />
);

/* ── Tabbed content (Parameters / Result) ────────────────────────── */

export type ToolTabbedContentProps = {
  input: ToolUIPart["input"];
  output: ToolUIPart["output"];
  errorText?: ToolUIPart["errorText"];
};

export const ToolTabbedContent = ({
  input,
  output,
  errorText,
}: ToolTabbedContentProps) => {
  const [activeTab, setActiveTab] = useState<"parameters" | "result">("parameters");
  const hasOutput = output != null || !!errorText;

  let OutputNode: ReactNode = null;
  if (errorText) {
    OutputNode = <ToolCode code={errorText} className="text-destructive" />;
  } else if (output != null) {
    if (typeof output === "object" && !isValidElement(output)) {
      OutputNode = <ToolCode code={formatToolValue(output)} />;
    } else if (typeof output === "string") {
      OutputNode = <ToolCode code={output} />;
    } else {
      OutputNode = <div>{output as ReactNode}</div>;
    }
  }

  return (
    <div className="border-t">
      {/* Tabs */}
      <div className="flex">
        <button
          type="button"
          className={cn(
            "px-4 py-2 text-xs font-medium transition-colors border-b-2",
            activeTab === "parameters"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("parameters")}
        >
          Parameters
        </button>
        <button
          type="button"
          className={cn(
            "px-4 py-2 text-xs font-medium transition-colors border-b-2",
            activeTab === "result"
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
          onClick={() => setActiveTab("result")}
        >
          Result
        </button>
      </div>

      {/* Tab content */}
      <div className="p-3">
        {activeTab === "parameters" && (
          <div className="rounded-md border bg-muted/50 p-3 max-h-64 overflow-auto">
            <ToolCode code={formatToolValue(input ?? {})} />
          </div>
        )}
        {activeTab === "result" && (
          <div
            className={cn(
              "rounded-md border p-3 max-h-64 overflow-auto",
              errorText ? "bg-destructive/10" : "bg-muted/50"
            )}
          >
            {hasOutput ? (
              <div className={cn(errorText && "text-destructive")}>
                {OutputNode}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">(pending...)</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export type ToolGroupProps = {
  group: ToolGroupType
  isToolOpen: (toolId: string) => boolean
  onToolOpenChange: (toolId: string, open: boolean) => void
}

const getGroupState = (tools: ToolCall[]): ToolUIPart["state"] => {
  if (tools.some(t => t.status === 'error')) return 'output-error'
  if (tools.some(t => t.status === 'running')) return 'input-available'
  if (tools.some(t => t.status === 'pending')) return 'input-streaming'
  return 'output-available'
}

export const ToolGroupComponent = ({ group, isToolOpen, onToolOpenChange }: ToolGroupProps) => {
  const [open, setOpen] = useState(false)
  const state = getGroupState(group.items)
  const isCompleted = state === 'output-available' || state === 'output-error'
  const runningTool = group.items.find(t => t.status === 'running' || t.status === 'pending')
  const currentTool = runningTool ?? group.items[group.items.length - 1]
  const toolCount = group.items.length
  const ranLabel = `Ran ${toolCount} tool${toolCount !== 1 ? 's' : ''}`
  const actions = isCompleted ? getToolActionsSummary(group.items) : ''
  // Plain string used as the AnimatePresence key + tooltip; the rendered node
  // shows the action summary in a lighter gray than the "Ran N tools" prefix.
  const summaryText = isCompleted
    ? `${ranLabel} · ${actions}`
    : currentTool ? getToolDisplayName(currentTool) : getToolGroupSummary(group.items)
  const summaryNode: ReactNode = isCompleted
    ? <>{ranLabel} <span className="font-normal text-muted-foreground">{`· ${actions}`}</span></>
    : summaryText

  const leadIcon = getLeadIcon(state)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="not-prose mb-4 w-full rounded-[28px] border bg-[var(--card-surface)] transition-colors duration-150 ease-out hover:border-foreground/30"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {leadIcon}
          <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height: '1.25rem' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={summaryText}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="absolute inset-0 truncate text-left font-medium text-sm leading-5"
                title={summaryText}
              >
                {summaryNode}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[collapsible-down_0.09s_ease-out] data-[state=closed]:animate-[collapsible-up_0.08s_ease-in]">
        <div className="flex flex-col gap-2 p-2">
          {group.items.map((tool) => {
            const toolState = toToolState(tool.status)
            const isOpen = isToolOpen(tool.id)
            return (
              <Tool
                key={tool.id}
                open={isOpen}
                onOpenChange={(o) => onToolOpenChange(tool.id, o)}
                className="mb-0 rounded-[20px] border-border/60 bg-transparent hover:border-border/60"
              >
                <ToolHeader
                  title={getToolDisplayName(tool)}
                  type={`tool-${tool.name}`}
                  state={toolState}
                  className="text-muted-foreground"
                  hideLeadIcon
                />
                <ToolContent>
                  <ToolTabbedContent
                    input={tool.input as ToolUIPart["input"]}
                    output={tool.result as ToolUIPart["output"]}
                    errorText={tool.status === 'error' ? 'Tool error' : undefined}
                  />
                </ToolContent>
              </Tool>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
