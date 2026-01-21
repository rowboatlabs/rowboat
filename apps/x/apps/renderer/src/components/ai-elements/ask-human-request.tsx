"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MessageCircleIcon, ArrowUpIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useState, useRef, useEffect } from "react";

export type AskHumanRequestProps = ComponentProps<"div"> & {
  query: string;
  onResponse: (response: string) => void;
  isProcessing?: boolean;
};

export const AskHumanRequest = ({
  className,
  query,
  onResponse,
  isProcessing = false,
  ...props
}: AskHumanRequestProps) => {
  const [response, setResponse] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-focus the textarea when component mounts
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = response.trim();
    if (trimmed && !isProcessing) {
      onResponse(trimmed);
      setResponse("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSubmit = Boolean(response.trim()) && !isProcessing;

  return (
    <div
      className={cn(
        "not-prose mb-4 w-full rounded-md border border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20",
        className
      )}
      {...props}
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <MessageCircleIcon className="size-5 text-blue-600 dark:text-blue-500 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-3">
            <div>
              <h3 className="font-semibold text-sm text-foreground mb-1">
                Question from Agent
              </h3>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {query}
              </p>
            </div>
            <div className="space-y-2">
              <Textarea
                ref={textareaRef}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response..."
                disabled={isProcessing}
                rows={3}
                className="resize-none"
              />
              <div className="flex justify-end">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="gap-2"
                >
                  <ArrowUpIcon className="size-4" />
                  Send Response
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
