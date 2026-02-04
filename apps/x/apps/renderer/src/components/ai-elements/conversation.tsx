"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

// Threshold in pixels - if user scrolls more than this from bottom, they're considered "engaged"
const SCROLL_ENGAGEMENT_THRESHOLD = 100;

/**
 * Component that preserves scroll position when user has scrolled away from bottom.
 * Place this inside a StickToBottom context to prevent unwanted scroll jumps.
 */
export const ScrollPositionPreserver = () => {
  const { isAtBottom } = useStickToBottomContext();
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const isUserEngagedRef = useRef(false);
  const savedScrollTopRef = useRef<number | null>(null);
  const lastContentHeightRef = useRef<number>(0);

  useEffect(() => {
    // Find the scroll container (StickToBottom creates a scrollable element)
    const findScrollContainer = () => {
      // The scroll container is the element with overflow-y-auto/scroll
      const containers = document.querySelectorAll('[data-stick-to-bottom-scroll-container]');
      if (containers.length > 0) {
        return containers[0] as HTMLElement;
      }
      // Fallback: find by class pattern from the library
      const fallback = document.querySelector('.use-stick-to-bottom-scroll-container');
      return fallback as HTMLElement | null;
    };

    // Try to find it, the library creates it dynamically
    const container = findScrollContainer();
    if (container) {
      scrollContainerRef.current = container;
    }
  }, []);

  // Track when user scrolls away from bottom
  useEffect(() => {
    if (!isAtBottom) {
      // User is not at bottom - they've scrolled up
      isUserEngagedRef.current = true;

      // Save their current position
      if (scrollContainerRef.current) {
        savedScrollTopRef.current = scrollContainerRef.current.scrollTop;
        lastContentHeightRef.current = scrollContainerRef.current.scrollHeight;
      }
    }
  }, [isAtBottom]);

  // When user reaches bottom again, reset engagement
  useEffect(() => {
    if (isAtBottom && isUserEngagedRef.current) {
      isUserEngagedRef.current = false;
      savedScrollTopRef.current = null;
    }
  }, [isAtBottom]);

  // Use MutationObserver to detect content changes and restore position if needed
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new MutationObserver(() => {
      // If user was engaged (scrolled away) and we have a saved position
      if (isUserEngagedRef.current && savedScrollTopRef.current !== null) {
        const currentHeight = container.scrollHeight;
        const previousHeight = lastContentHeightRef.current;

        // If content height changed significantly and user was scrolled away
        if (Math.abs(currentHeight - previousHeight) > 10) {
          // Calculate how far from bottom they were
          const distanceFromBottom = previousHeight - savedScrollTopRef.current - container.clientHeight;

          // Restore position relative to where they were
          // If they were reading something in the middle, keep them there
          if (distanceFromBottom > SCROLL_ENGAGEMENT_THRESHOLD) {
            // Keep them at the same scroll position (reading older content)
            container.scrollTop = savedScrollTopRef.current;
          }

          // Update saved values
          lastContentHeightRef.current = currentHeight;
        }
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

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
