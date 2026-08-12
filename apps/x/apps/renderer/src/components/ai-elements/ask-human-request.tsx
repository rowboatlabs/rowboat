"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ASK_HUMAN_SKIP_ANSWER } from "@/lib/chat-conversation";
import { cn } from "@/lib/utils";
import { MessageCircleQuestionMarkIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

const letterFor = (index: number): string => String.fromCharCode(65 + index);

// Monochrome panel shared by the pending card and the settled Q&A card.
const CARD_SHELL_CLASS =
  "not-prose my-1.5 w-full rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-[13px]";

const CHOICE_ROW_CLASS =
  "-mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-[5px] text-left";

const LetterChip = ({ char, active, selected }: { char: string; active?: boolean; selected?: boolean }) => (
  <kbd
    className={cn(
      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border font-mono text-[10.5px] transition-colors",
      selected
        ? "border-primary bg-primary text-primary-foreground"
        : active
          ? "border-primary/60 bg-muted/70 text-primary"
          : "border-border bg-muted/70 text-muted-foreground"
    )}
  >
    {char}
  </kbd>
);

/** Circled-letter glyph for the answer line (no lucide equivalent). */
const CircleAGlyph = () => (
  <span
    aria-hidden
    className="flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 font-mono text-[9px] leading-none text-muted-foreground/70"
  >
    A
  </span>
);

/** Question text with the question-bubble icon (and, for a batch of
 *  questions, a "1 of 5" counter) riding the right edge. */
const QuestionLine = ({ question, counter }: { question: string; counter?: string }) => (
  <div className="flex items-start justify-between gap-3">
    <p className="min-w-0 flex-1 whitespace-pre-wrap font-medium leading-relaxed text-foreground">
      {question}
    </p>
    <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
      {counter && (
        <span className="text-[11px] tabular-nums leading-4 text-muted-foreground/60">{counter}</span>
      )}
      <MessageCircleQuestionMarkIcon aria-hidden className="size-4 shrink-0 text-muted-foreground/60" />
    </span>
  </div>
);

export type AskHumanSettledProps = {
  question: string;
  answer: string;
  skipped: boolean;
  isError?: boolean;
};

/**
 * Settled transcript card for an answered/skipped/cancelled ask-human call:
 * the question line, then the answer line (italic "Skipped" for the skip
 * sentinel) with a circled-A glyph on the right edge.
 */
export const AskHumanSettled = ({ question, answer, skipped, isError = false }: AskHumanSettledProps) => (
  <div className={cn(CARD_SHELL_CLASS, "grid gap-1")}>
    {question && <QuestionLine question={question} />}
    <div className="flex items-start justify-between gap-3">
      <p
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground",
          skipped && "italic text-muted-foreground/80",
          isError && "text-red-600 dark:text-red-500"
        )}
      >
        {skipped ? "Skipped" : answer}
      </p>
      <span className="mt-0.5 flex h-4 items-center">
        <CircleAGlyph />
      </span>
    </div>
  </div>
);

export type AskHumanRequestProps = ComponentProps<"div"> & {
  query: string;
  options?: string[];
  /** Options become toggles (pick all that apply); the answer joins every
   *  selected label (plus any "Other" text) with ", ". */
  multiSelect?: boolean;
  /** Position within a batch of simultaneous questions ("1 of 5"). Omitted
   *  for a lone question. */
  progress?: { current: number; total: number };
  onResponse: (response: string) => void;
  isProcessing?: boolean;
};

/**
 * Inline card for a pending `ask-human` tool call (the turn is suspended on
 * it). With options: lettered A/B/C/D rows plus an always-present
 * "Other (type your answer)" row — picking stages a choice, Continue (or
 * Enter) confirms it. Without options: a free-text field. Skip resolves the
 * call with ASK_HUMAN_SKIP_ANSWER so the model proceeds on its own.
 *
 * Keyboard (options mode): letters/digits pick a row, arrows move the
 * cursor, Enter confirms. The window listener stands down whenever focus is
 * on a focusable control (composer, buttons, the Other field) so it never
 * eats keystrokes meant elsewhere; the card grabs focus on mount so keys
 * work immediately.
 */
export const AskHumanRequest = ({
  className,
  query,
  options,
  multiSelect = false,
  progress,
  onResponse,
  isProcessing = false,
  ...props
}: AskHumanRequestProps) => {
  const hasOptions = Array.isArray(options) && options.length > 0;
  const choices = hasOptions ? options : [];
  const isMulti = multiSelect && hasOptions;

  const [draft, setDraft] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Multi-select: the set of toggled option indices. Unlike single-select,
  // toggles and "Other" text are additive, not mutually exclusive.
  const [selectedSet, setSelectedSet] = useState<ReadonlySet<number>>(new Set());
  // Keyboard cursor. 0..choices.length-1 are the options; the trailing index
  // (=== choices.length) is the "Other" free-text row.
  const [activeIndex, setActiveIndex] = useState(0);
  // Latched after a successful submit so a slow round-trip can't double-send.
  const [submitted, setSubmitted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const disabled = isProcessing || submitted;
  const trimmedDraft = draft.trim();
  const stagedAnswer = isMulti
    ? [...[...selectedSet].sort((a, b) => a - b).map((i) => choices[i]), ...(trimmedDraft ? [trimmedDraft] : [])].join(
        ", "
      ) || null
    : selectedIndex !== null
      ? choices[selectedIndex]
      : trimmedDraft || null;

  useEffect(() => {
    // Free-text mode: focus the field. Options mode: focus the card container
    // so letter/arrow/Enter keys work without a click.
    if (!hasOptions) {
      textareaRef.current?.focus();
    } else {
      containerRef.current?.focus();
    }
  }, [hasOptions]);

  const respond = useCallback(
    (answer: string) => {
      if (disabled || !answer) return;
      setSubmitted(true);
      onResponse(answer);
    },
    [disabled, onResponse]
  );

  const selectChoice = useCallback(
    (index: number) => {
      if (disabled) return;
      if (isMulti) {
        // Toggle; selections and "Other" text are additive in multi mode.
        setSelectedSet((prev) => {
          const next = new Set(prev);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          return next;
        });
      } else {
        // Picking a choice and typing are mutually exclusive answers.
        setDraft("");
        setSelectedIndex(index);
      }
      setActiveIndex(index);
      // Return focus to the card so Enter confirms instead of re-clicking
      // the row button the click just focused.
      containerRef.current?.focus();
    },
    [disabled, isMulti]
  );

  const submitStaged = useCallback(() => {
    if (stagedAnswer) respond(stagedAnswer);
  }, [respond, stagedAnswer]);

  const onDraftChange = (value: string) => {
    setDraft(value);
    // Single-select: typing is its own answer — drop any picked choice so the
    // two inputs can't both look selected. Multi-select: additive, keep both.
    if (!isMulti && value.trim()) setSelectedIndex(null);
  };

  const handleTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitStaged();
    }
  };

  // Window-level shortcuts for options mode.
  useEffect(() => {
    if (!hasOptions || disabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;

      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        active !== containerRef.current &&
        (active.isContentEditable ||
          active.matches('a[href], button, input, select, textarea, [role="button"]'))
      ) {
        return;
      }

      const itemCount = choices.length + 1; // + the Other row

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        // Single-select: a move is not a pick — clear the staged choice so
        // the cursor and the selection can't disagree. Multi-select keeps its
        // toggles; the cursor just browses.
        if (!isMulti) setSelectedIndex(null);
        setActiveIndex((index) => (index + delta + itemCount) % itemCount);
        return;
      }

      // Multi-select: Space toggles the highlighted row (checkbox convention).
      if (isMulti && event.key === " " && activeIndex < choices.length) {
        event.preventDefault();
        selectChoice(activeIndex);
        return;
      }

      let index = -1;
      if (/^[1-9]$/.test(event.key)) {
        index = Number(event.key) - 1;
      } else {
        const key = event.key.toLowerCase();
        if (key.length === 1 && key >= "a" && key <= "z") {
          index = key.charCodeAt(0) - 97;
        }
      }
      // Only the rows this card renders; anything past the Other row belongs
      // to the rest of the app.
      if (index >= 0) {
        if (index < choices.length) {
          event.preventDefault();
          selectChoice(index);
        } else if (index === choices.length) {
          event.preventDefault();
          setActiveIndex(index);
          textareaRef.current?.focus();
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (stagedAnswer) {
          submitStaged();
        } else if (activeIndex < choices.length) {
          if (isMulti) {
            // Nothing toggled yet: Enter stages the highlighted row rather
            // than submitting — multi-select answers are confirmed explicitly.
            selectChoice(activeIndex);
          } else {
            // Enter on a highlighted, unstaged row answers with it directly.
            respond(choices[activeIndex]);
          }
        } else {
          textareaRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, choices, disabled, hasOptions, isMulti, respond, selectChoice, stagedAnswer, submitStaged]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={cn(CARD_SHELL_CLASS, "outline-none", className)}
      {...props}
    >
      <QuestionLine
        question={query}
        counter={progress ? `${progress.current} of ${progress.total}` : undefined}
      />
      {isMulti && (
        <p className="mt-0.5 text-xs text-muted-foreground/70">Select all that apply</p>
      )}

      <div className="mt-2 pl-1">
        {hasOptions ? (
          <div className="flex flex-col gap-px" role="group" aria-multiselectable={isMulti || undefined}>
            {choices.map((choice, index) => {
              const isSelected = isMulti ? selectedSet.has(index) : selectedIndex === index;
              return (
                <button
                  key={`${index}-${choice}`}
                  type="button"
                  aria-current={activeIndex === index || undefined}
                  aria-pressed={isMulti ? isSelected : undefined}
                  aria-keyshortcuts={`${letterFor(index)} ${index + 1}`}
                  disabled={disabled}
                  onClick={() => selectChoice(index)}
                  className={cn(
                    CHOICE_ROW_CLASS,
                    "text-foreground/90 hover:bg-muted/60",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    activeIndex === index && !isSelected && "bg-muted/60",
                    isSelected && "text-foreground"
                  )}
                >
                  <LetterChip
                    char={letterFor(index)}
                    active={activeIndex === index}
                    selected={isSelected}
                  />
                  <span className="min-w-0 flex-1 break-words leading-relaxed">{choice}</span>
                </button>
              );
            })}
            <label
              className={cn(
                CHOICE_ROW_CLASS,
                "cursor-text",
                activeIndex === choices.length && "bg-muted/60"
              )}
            >
              <LetterChip
                char={letterFor(choices.length)}
                active={activeIndex === choices.length}
                selected={Boolean(trimmedDraft)}
              />
              <Textarea
                ref={textareaRef}
                dir="auto"
                rows={1}
                value={draft}
                disabled={disabled}
                placeholder="Other (type your answer)"
                onChange={(e) => onDraftChange(e.target.value)}
                onFocus={() => {
                  // Single-select: focusing "Other" abandons a picked row.
                  // Multi-select: additive — toggles stay.
                  if (!isMulti) setSelectedIndex(null);
                  setActiveIndex(choices.length);
                }}
                onKeyDown={handleTextareaKey}
                className="min-h-0 flex-1 resize-none rounded-md border-transparent bg-transparent px-1.5 py-0.5 text-[13px] leading-relaxed shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:bg-transparent"
              />
            </label>
          </div>
        ) : (
          <Textarea
            ref={textareaRef}
            dir="auto"
            rows={2}
            value={draft}
            disabled={disabled}
            placeholder="Type your answer…"
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleTextareaKey}
            className="min-h-0 resize-none text-[13px]"
          />
        )}

        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => respond(ASK_HUMAN_SKIP_ANSWER)}
            className="h-7 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={disabled || !stagedAnswer}
            onClick={submitStaged}
            className="h-7 rounded-full px-3 text-xs"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
};
