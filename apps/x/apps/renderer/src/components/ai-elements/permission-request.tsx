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
import { AlertTriangleIcon, CheckCircleIcon, CheckIcon, ChevronDownIcon, XCircleIcon, XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { ToolCallPart } from "@x/shared/dist/message.js";
import z from "zod";

export type PermissionRequestProps = ComponentProps<"div"> & {
  toolCall: z.infer<typeof ToolCallPart>;
  onApprove?: () => void;
  onApproveSession?: () => void;
  onApproveAlways?: () => void;
  onDeny?: () => void;
  isProcessing?: boolean;
  response?: 'approve' | 'deny' | null;
};

export const PermissionRequest = ({
  className,
  toolCall,
  onApprove,
  onApproveSession,
  onApproveAlways,
  onDeny,
  isProcessing = false,
  response = null,
  ...props
}: PermissionRequestProps) => {
  // Extract command from arguments if it's executeCommand
  const command = toolCall.toolName === "executeCommand" 
    ? (typeof toolCall.arguments === "object" && toolCall.arguments !== null && "command" in toolCall.arguments
        ? String(toolCall.arguments.command)
        : JSON.stringify(toolCall.arguments))
    : null;

  const isResponded = response !== null;
  const isApproved = response === 'approve';

  return (
    <div
      className={cn(
        "not-prose mb-4 w-full rounded-md border",
        isResponded
          ? isApproved
            ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
            : "border-red-500/50 bg-red-50/50 dark:bg-red-950/20"
          : "border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20",
        className
      )}
      {...props}
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          {isResponded ? (
            isApproved ? (
              <CheckCircleIcon className="size-5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
            ) : (
              <XCircleIcon className="size-5 text-red-600 dark:text-red-500 shrink-0 mt-0.5" />
            )
          ) : (
            <AlertTriangleIcon className="size-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <h3 className="font-semibold text-sm text-foreground">
                  {isResponded ? (isApproved ? "Permission Granted" : "Permission Denied") : "Permission Required"}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {isResponded ? "Requested:" : "The agent wants to execute:"} <span className="font-mono font-medium">{toolCall.toolName}</span>
                </p>
              </div>
              {isResponded && (
                <Badge 
                  variant="secondary" 
                  className={cn(
                    "shrink-0",
                    isApproved 
                      ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400" 
                      : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
                  )}
                >
                  {isApproved ? (
                    <>
                      <CheckIcon className="size-3 mr-1" />
                      Approved
                    </>
                  ) : (
                    <>
                      <XIcon className="size-3 mr-1" />
                      Denied
                    </>
                  )}
                </Badge>
              )}
            </div>
            {command && (
              <div className="rounded-md border bg-background/50 p-3 mt-3">
                <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Command
                </p>
                <pre className="whitespace-pre-wrap text-xs font-mono text-foreground break-all">
                  {command}
                </pre>
              </div>
            )}
            {!command && toolCall.arguments && (
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
                className={cn("flex-1", command && "rounded-r-none")}
              >
                <CheckIcon className="size-4" />
                Approve
              </Button>
              {command && (
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
          </div>
        )}
      </div>
    </div>
  );
};
