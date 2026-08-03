"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDownIcon,
  GlobeIcon,
  LoaderIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { quietRowContainerClass, quietRowGlyphSlotClass, quietRowTriggerClass } from "@/components/ai-elements/tool";

interface WebSearchResultProps {
  query: string;
  results: Array<{ title: string; url: string; description: string }>;
  status: "pending" | "running" | "completed" | "error";
  title?: string;
}

// How long each fetched website stays on the rolling header before the
// next one slides in. Kept slow enough to read the domain + title.
const ROLL_INTERVAL_MS = 700;

// How many favicons to show in the settled stack before the rest collapse
// into a "+N" chip. The text names this many domains too, so the chip count
// (total - MAX_STACK) lines up with the "and N others" in the summary.
const MAX_STACK = 3;

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function faviconUrl(domain: string, size = 32): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

// Collapse the result list into unique domains, preserving order.
function uniqueDomains(results: WebSearchResultProps["results"]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const result of results) {
    const domain = getDomain(result.url);
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

// Summary with text hierarchy: "Searched" + "and N others" are secondary
// weight/color, the domain names are primary text at medium weight.
function buildSearchedSummary(domains: string[]): React.ReactNode {
  const muted = "font-normal text-muted-foreground";
  const name = (d: string) => <span className="font-medium text-foreground">{d}</span>;
  if (domains.length === 1) {
    return (
      <>
        <span className={muted}>Searched </span>
        {name(domains[0])}
      </>
    );
  }
  if (domains.length === 2) {
    return (
      <>
        <span className={muted}>Searched </span>
        {name(domains[0])}
        <span className={muted}> and </span>
        {name(domains[1])}
      </>
    );
  }
  const others = domains.length - 2;
  return (
    <>
      <span className={muted}>Searched </span>
      {name(domains[0])}
      <span className={muted}>, </span>
      {name(domains[1])}
      <span className={muted}>{` and ${others} other${others !== 1 ? "s" : ""}`}</span>
    </>
  );
}

type RollPhase = "searching" | "rolling" | "settled";

export function WebSearchResult({ query, results, status, title = "Searched the web" }: WebSearchResultProps) {
  const isRunning = status === "pending" || status === "running";
  const [open, setOpen] = useState(false);

  const domains = useMemo(() => uniqueDomains(results), [results]);

  // Drive the one-shot rolling reveal. Results arrive all at once, so we
  // simulate "fetching one site at a time" by stepping through them with the
  // same slide animation the tool group uses, then settle on a summary.
  // `settled` is seeded from the initial status so a card loaded already-
  // complete from history skips straight to the summary (no roll).
  const [settled, setSettled] = useState(() => !isRunning);
  const [rollIndex, setRollIndex] = useState(0);

  // Phase is fully derived: searching while the tool runs, rolling once
  // results land, then settled. No setState-in-effect needed for transitions.
  const phase: RollPhase = isRunning
    ? "searching"
    : !settled && results.length > 0
      ? "rolling"
      : "settled";

  // Warm the browser cache for every favicon the moment results arrive, so
  // each icon is already loaded by the time its row rolls in (~700ms each).
  // Without this the network fetch lags the text and rows flash icon-less.
  useEffect(() => {
    for (const result of results) {
      const img = new Image();
      img.src = faviconUrl(getDomain(result.url));
    }
  }, [results]);

  // Advance the roll, then settle after the last site has had its moment.
  // setState only fires inside the timeout callback, never synchronously.
  useEffect(() => {
    if (phase !== "rolling") return;
    const isLast = rollIndex >= results.length - 1;
    const timer = setTimeout(
      () => (isLast ? setSettled(true) : setRollIndex((i) => i + 1)),
      ROLL_INTERVAL_MS,
    );
    return () => clearTimeout(timer);
  }, [phase, rollIndex, results.length]);

  // Build the content for the compact (collapsed) header line. Each distinct
  // value gets a unique key so AnimatePresence runs the slide transition.
  let headerKey: string;
  let headerContent: React.ReactNode;
  if (phase === "searching") {
    headerKey = "searching";
    headerContent = (
      <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
        <span className="truncate">Searching the web&hellip;</span>
      </span>
    );
  } else if (phase === "rolling") {
    const result = results[rollIndex];
    const domain = getDomain(result.url);
    headerKey = `roll-${rollIndex}`;
    headerContent = (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <img src={faviconUrl(domain)} alt="" className="size-3.5 shrink-0 rounded-sm bg-muted/60" />
        <span className="truncate">
          <span className="text-muted-foreground">{domain}</span>
          <span className="text-muted-foreground/50"> &middot; </span>
          <span>{result.title}</span>
        </span>
      </span>
    );
  } else {
    headerKey = "settled";
    const stack = domains.slice(0, MAX_STACK);
    // Chip count matches the "and N others" in the text (total minus the 2
    // named domains), shown only when there are sites beyond the stack.
    const overflow = domains.length > MAX_STACK ? domains.length - 2 : 0;
    headerContent = (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {domains.length > 0 ? (
          <span className="flex shrink-0 items-center">
            {stack.map((domain, i) => (
              <img
                key={domain}
                src={faviconUrl(domain)}
                alt=""
                className="size-4 rounded-full bg-muted object-cover -ml-[4px] first:ml-0"
                style={{ zIndex: stack.length - i }}
              />
            ))}
            {overflow > 0 && (
              <span className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 dark:bg-muted text-[9px] font-medium text-muted-foreground">
                +{overflow}
              </span>
            )}
          </span>
        ) : (
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">
          {domains.length > 0 ? buildSearchedSummary(domains) : title}
        </span>
      </span>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={quietRowContainerClass}>
      <CollapsibleTrigger className={quietRowTriggerClass}>
        {/* Same lead glyph slot as the quiet tool rows: spinner while the
            search runs, red dot on failure, expand chevron once settled. */}
        <span className={quietRowGlyphSlotClass}>
          {status === "error" ? (
            <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-500" />
          ) : phase === "searching" ? (
            <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-3 text-muted-foreground/50 transition-transform group-data-[state=open]/row:rotate-180" />
          )}
        </span>
        {/* Rolling header: clipped, fixed height so sliding lines stay contained */}
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ height: "1.25rem" }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={headerKey}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="absolute inset-0 flex items-center text-left"
            >
              {headerContent}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {phase === "settled" && domains.length > 0 && (
            <span className="whitespace-nowrap text-muted-foreground/60 tabular-nums">
              {domains.length} source{domains.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-[collapsible-down_0.09s_ease-out] data-[state=closed]:animate-[collapsible-up_0.08s_ease-in]">
        <div className="my-1 ml-[2.5px] space-y-2 border-l-2 border-border pl-3">
          {/* Query */}
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <GlobeIcon className="size-3 shrink-0" />
            <span className="truncate">{query}</span>
          </div>

          {/* Results list */}
          {results.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
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
                    className="-mx-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 py-1 text-[13px] transition-colors hover:bg-muted/50"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <img
                        src={faviconUrl(domain)}
                        alt=""
                        className="size-3.5 shrink-0"
                      />
                      <span className="truncate">{result.title}</span>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {domain}
                    </span>
                  </a>
                );
              })}
            </div>
          )}

          {/* Status — only while the search is still running. */}
          {isRunning && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LoaderIcon className="size-3 animate-spin" />
              <span>Searching...</span>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
