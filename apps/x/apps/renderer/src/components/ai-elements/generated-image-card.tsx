"use client";

import { cn } from "@/lib/utils";
import { ImageIcon, ImageOffIcon, LoaderIcon } from "lucide-react";

interface GeneratedImageCardProps {
  prompt: string;
  /** Workspace-relative path of the generated image (present once completed). */
  path?: string;
  error?: string;
  status: "pending" | "running" | "completed" | "error";
}

// Chat card for the generate-image builtin: spinner while the model paints,
// then the image itself served over app://workspace (see main.ts protocol).
export function GeneratedImageCard({ prompt, path, error, status }: GeneratedImageCardProps) {
  const isRunning = status === "pending" || status === "running";
  const failed = !isRunning && (!!error || !path);

  if (isRunning || failed) {
    return (
      <div className="not-prose mb-4 flex w-full items-center gap-2.5 rounded-[28px] border bg-[var(--card-surface)] px-4 py-2.5 text-sm">
        {isRunning ? (
          <LoaderIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <ImageOffIcon className="size-4 shrink-0 text-destructive" />
        )}
        <span className={cn("min-w-0 truncate", isRunning ? "text-muted-foreground" : "text-destructive")}>
          {isRunning
            ? `Generating image${prompt ? ` — ${prompt}` : "…"}`
            : error || "Image generation failed"}
        </span>
      </div>
    );
  }

  const src = `app://workspace/${path!.split("/").map(encodeURIComponent).join("/")}`;
  return (
    <div className="not-prose mb-4 w-fit max-w-full overflow-hidden rounded-2xl border bg-[var(--card-surface)]">
      <img
        src={src}
        alt={prompt || "Generated image"}
        className="block max-h-96 max-w-full object-contain"
      />
      {prompt && (
        <div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3 shrink-0" />
          <span className="truncate">{prompt}</span>
        </div>
      )}
    </div>
  );
}
