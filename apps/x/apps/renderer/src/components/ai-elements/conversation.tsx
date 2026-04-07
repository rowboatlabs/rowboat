"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode, RefObject } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const BOTTOM_THRESHOLD_PX = 8;
const MAX_ANCHOR_RETRIES = 6;

interface ConversationContextValue {
  contentRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
}

const ConversationContext = createContext<ConversationContextValue | null>(null);

export type ConversationProps = ComponentProps<"div"> & {
  anchorMessageId?: string | null;
  anchorRequestKey?: number;
  children?: ReactNode;
};

export const Conversation = ({
  anchorMessageId = null,
  anchorRequestKey,
  children,
  className,
  ...props
}: ConversationProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const updateBottomState = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsAtBottom(distanceFromBottom <= BOTTOM_THRESHOLD_PX);
  }, []);

  const applyAnchorLayout = useCallback(
    (scrollToAnchor: boolean): boolean => {
      const container = scrollRef.current;
      const content = contentRef.current;
      const spacer = spacerRef.current;

      if (!container || !content || !spacer) {
        return false;
      }

      if (!anchorMessageId) {
        spacer.style.height = "0px";
        updateBottomState();
        return true;
      }

      const anchor = content.querySelector<HTMLElement>(
        `[data-message-id="${anchorMessageId}"]`
      );

      if (!anchor) {
        spacer.style.height = "0px";
        updateBottomState();
        return false;
      }

      spacer.style.height = "0px";

      const contentPaddingTop = Number.parseFloat(
        window.getComputedStyle(content).paddingTop || "0"
      );
      const anchorTop = anchor.offsetTop;
      const targetScrollTop = Math.max(0, anchorTop - contentPaddingTop);
      const requiredSlack = Math.max(
        0,
        targetScrollTop - (content.scrollHeight - container.clientHeight)
      );

      spacer.style.height = `${Math.ceil(requiredSlack)}px`;

      if (scrollToAnchor) {
        container.scrollTop = targetScrollTop;
      }

      updateBottomState();
      return true;
    },
    [anchorMessageId, updateBottomState]
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      updateBottomState();
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [updateBottomState]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let rafId: number | null = null;

    const schedule = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        applyAnchorLayout(false);
      });
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    observer.observe(content);
    schedule();

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [applyAnchorLayout]);

  useLayoutEffect(() => {
    if (anchorRequestKey === undefined) return;

    let attempts = 0;
    let rafId: number | null = null;

    const tryAnchor = () => {
      if (applyAnchorLayout(true)) {
        return;
      }
      if (attempts >= MAX_ANCHOR_RETRIES) {
        return;
      }
      attempts += 1;
      rafId = requestAnimationFrame(tryAnchor);
    };

    tryAnchor();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [anchorRequestKey, applyAnchorLayout]);

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    updateBottomState();
  }, [updateBottomState]);

  const contextValue = useMemo<ConversationContextValue>(
    () => ({
      contentRef,
      isAtBottom,
      scrollRef,
      scrollToBottom,
    }),
    [isAtBottom, scrollToBottom]
  );

  return (
    <ConversationContext.Provider value={contextValue}>
      <div
        className={cn("relative flex-1 overflow-hidden", className)}
        role="log"
        {...props}
      >
        <div
          className="h-full w-full overflow-y-auto [scrollbar-gutter:stable]"
          ref={scrollRef}
        >
          {children}
          <div ref={spacerRef} aria-hidden="true" />
        </div>
      </div>
    </ConversationContext.Provider>
  );
};

const useConversationContext = () => {
  const context = useContext(ConversationContext);

  if (!context) {
    throw new Error(
      "Conversation components must be used within a Conversation component."
    );
  }

  return context;
};

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => {
  const { contentRef } = useConversationContext();

  return (
    <div
      className={cn("flex flex-col gap-8 p-4", className)}
      ref={contentRef}
      {...props}
    />
  );
};

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  description?: string;
  icon?: ReactNode;
  title?: string;
};

export const ConversationEmptyState = ({
  children,
  className,
  description = "Start a conversation to see messages here",
  icon,
  title = "No messages yet",
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <div className="space-y-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export const ScrollPositionPreserver = () => null;

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useConversationContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-6 left-[50%] z-10 h-12 w-12 translate-x-[-50%] rounded-full border border-border/70 bg-background/95 text-foreground shadow-lg backdrop-blur-sm transition hover:bg-background",
          className
        )}
        aria-label="Scroll to latest message"
        onClick={handleScrollToBottom}
        type="button"
        variant="ghost"
        {...props}
      >
        <ArrowDownIcon className="size-6" strokeWidth={1.75} />
      </Button>
    )
  );
};
