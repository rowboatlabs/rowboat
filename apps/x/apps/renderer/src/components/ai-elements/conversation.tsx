"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

// Context to share scroll preservation state
interface ScrollPreservationContextValue {
  registerScrollContainer: (container: HTMLElement | null) => void;
  markUserEngaged: () => void;
  resetEngagement: () => void;
}

const ScrollPreservationContext = createContext<ScrollPreservationContextValue | null>(null);

export type ConversationProps = ComponentProps<typeof StickToBottom> & {
  children?: ReactNode;
};

export const Conversation = ({ className, children, ...props }: ConversationProps) => {
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const isUserEngagedRef = useRef(false);
  const savedScrollTopRef = useRef<number>(0);
  const lastScrollHeightRef = useRef<number>(0);

  const contextValue: ScrollPreservationContextValue = {
    registerScrollContainer: (container) => {
      setScrollContainer(container);
    },
    markUserEngaged: () => {
      // Only save position on first engagement, not on repeated calls
      if (!isUserEngagedRef.current && scrollContainer) {
        savedScrollTopRef.current = scrollContainer.scrollTop;
        lastScrollHeightRef.current = scrollContainer.scrollHeight;
      }
      isUserEngagedRef.current = true;
    },
    resetEngagement: () => {
      isUserEngagedRef.current = false;
    },
  };

  // Watch for content changes and restore scroll position if user was engaged
  useEffect(() => {
    if (!scrollContainer) return;

    let rafId: number | null = null;

    const checkAndRestoreScroll = () => {
      if (!isUserEngagedRef.current) return;

      const currentScrollTop = scrollContainer.scrollTop;
      const currentScrollHeight = scrollContainer.scrollHeight;
      const savedScrollTop = savedScrollTopRef.current;

      // If scroll position jumped significantly (auto-scroll happened)
      // and scroll height also changed (content changed), restore position
      if (
        Math.abs(currentScrollTop - savedScrollTop) > 50 &&
        currentScrollHeight !== lastScrollHeightRef.current
      ) {
        scrollContainer.scrollTop = savedScrollTop;
      }

      lastScrollHeightRef.current = currentScrollHeight;
    };

    // Use ResizeObserver to detect content changes
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(checkAndRestoreScroll);
    });

    resizeObserver.observe(scrollContainer);

    return () => {
      resizeObserver.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [scrollContainer]);

  return (
    <ScrollPreservationContext.Provider value={contextValue}>
      <StickToBottom
        className={cn("relative flex-1 overflow-y-hidden", className)}
        initial="smooth"
        resize="smooth"
        role="log"
        {...props}
      >
        {children}
      </StickToBottom>
    </ScrollPreservationContext.Provider>
  );
};

/**
 * Component that tracks scroll engagement and preserves position.
 * Must be used inside Conversation component.
 */
export const ScrollPositionPreserver = () => {
  const { isAtBottom, scrollRef } = useStickToBottomContext();
  const preservationContext = useContext(ScrollPreservationContext);
  const containerFoundRef = useRef(false);

  // Find and register scroll container on mount
  useLayoutEffect(() => {
    if (containerFoundRef.current || !preservationContext) return;

    // Use the local StickToBottom scroll container for this conversation instance.
    const container = scrollRef.current;
    if (container) {
      preservationContext.registerScrollContainer(container);
      containerFoundRef.current = true;
    }
  }, [preservationContext, scrollRef]);

  // Track engagement based on scroll position
  useEffect(() => {
    if (!preservationContext) return;

    if (!isAtBottom) {
      // User is not at bottom - mark as engaged
      preservationContext.markUserEngaged();
    } else {
      // User is back at bottom - reset
      preservationContext.resetEngagement();
    }
  }, [isAtBottom, preservationContext]);

  return null;
};

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
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

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
