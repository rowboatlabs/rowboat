"use client";

import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { type ComponentProps, type ReactNode, isValidElement, useState } from "react";

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
    className={cn("not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

export type ToolHeaderProps = {
  title?: string;
  type: ToolUIPart["type"];
  state: ToolUIPart["state"];
  className?: string;
};

const getStatusBadge = (status: ToolUIPart["state"]) => {
  const labels: Record<ToolUIPart["state"], string> = {
    "input-streaming": "Pending",
    "input-available": "Running",
    // @ts-expect-error state only available in AI SDK v6
    "approval-requested": "Awaiting Approval",
    "approval-responded": "Responded",
    "output-available": "Completed",
    "output-error": "Error",
    "output-denied": "Denied",
  };

  const icons: Record<ToolUIPart["state"], ReactNode> = {
    "input-streaming": <CircleIcon className="size-4" />,
    "input-available": <ClockIcon className="size-4 animate-pulse" />,
    // @ts-expect-error state only available in AI SDK v6
    "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
    "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
    "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
    "output-error": <XCircleIcon className="size-4 text-red-600" />,
    "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  };

  return (
    <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
      {icons[status]}
      {labels[status]}
    </Badge>
  );
};

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-4 p-3",
      className
    )}
    {...props}
  >
    <div className="flex items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">
        {title ?? type.split("-").slice(1).join("-")}
      </span>
      {getStatusBadge(state)}
    </div>
    <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
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

