"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  GlobeIcon,
  LoaderIcon,
} from "lucide-react";

interface WebSearchResultProps {
  query: string;
  results: Array<{ title: string; url: string; description: string }>;
  status: "pending" | "running" | "completed" | "error";
  title?: string;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function WebSearchResult({ query, results, status, title = "Searched the web" }: WebSearchResultProps) {
  const isRunning = status === "pending" || status === "running";

  return (
    <Collapsible defaultOpen className="not-prose mb-4 w-full rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-3">
        <div className="flex items-center gap-2">
          <GlobeIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
        </div>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 space-y-3">
          {/* Query + result count */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
              <GlobeIcon className="size-3.5 shrink-0" />
              <span className="truncate">{query}</span>
            </div>
            {results.length > 0 && (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Results list */}
          {results.length > 0 && (
            <div className="rounded-md border max-h-64 overflow-y-auto">
              {results.map((result, index) => {
                const domain = getDomain(result.url);
                return (
                  <a
                    key={index}
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(result.url, "_blank");
                    }}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50 transition-colors border-b last:border-b-0"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                        alt=""
                        className="size-4 shrink-0"
                      />
                      <span className="truncate">{result.title}</span>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {domain}
                    </span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Status */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isRunning ? (
              <>
                <LoaderIcon className="size-3.5 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <CheckCircleIcon className="size-3.5 text-green-600" />
                <span>Done</span>
              </>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
