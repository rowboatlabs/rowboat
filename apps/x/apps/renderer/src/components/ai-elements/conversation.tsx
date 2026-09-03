"use client";

import { Button } from "@/components/ui/button";
import {
  ChatScrollController,
  type ChatScrollMode,
} from "@/lib/chat-scroll";
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

const MAX_ANCHOR_RETRIES = 6;

interface ConversationContextValue {
  contentRef: RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollToBottom: () => void;
}

const ConversationContext = createContext<ConversationContextValue | null>(null);

export type ConversationProps = ComponentProps<"div"> & {
  /** 'chat' anchors sends at the viewport top (ChatGPT); 'code' jumps sends
   * to the live edge and follows the run (Codex). See lib/chat-scroll.ts. */
  scrollMode?: ChatScrollMode;
  /** Chat identity for cross-remount reading-position memory. */
  scrollMemoryKey?: string;
  anchorMessageId?: string | null;
  anchorRequestKey?: number;
  children?: ReactNode;
};

export const Conversation = ({
  scrollMode = "chat",
  scrollMemoryKey,
  anchorMessageId = null,
  anchorRequestKey,
  children,
  className,
  ...props
}: ConversationProps) => {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  // One controller per mounted conversation (the pane remounts per chat
  // identity, so mount lifetime == conversation binding lifetime).
  const [controller] = useState(
    () =>
      new ChatScrollController({ mode: scrollMode, memoryKey: scrollMemoryKey })
  );
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isFollowing, setIsFollowing] = useState(true);

  useEffect(() => {
    controller.setMode(scrollMode);
  }, [controller, scrollMode]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    const spacer = spacerRef.current;
    if (!container || !content || !spacer) return;

    controller.attach({ container, content, spacer });
    const unsubscribe = controller.subscribe((snapshot) => {
      setIsAtBottom(snapshot.nearBottom);
      setIsFollowing(snapshot.following);
    });

    return () => {
      unsubscribe();
      controller.detach();
    };
  }, [controller]);

  // A send bumps anchorRequestKey. Chat mode pins the new user message at the
  // viewport top; code mode (or an anchorless bump, e.g. new-chat reset)
  // returns to the live edge. The mount-time key is deliberately ignored:
  // remounts restore the remembered reading position instead of re-applying
  // a stale anchor.
  const appliedRequestKeyRef = useRef(anchorRequestKey);
  useLayoutEffect(() => {
    if (
      anchorRequestKey === undefined ||
      anchorRequestKey === appliedRequestKeyRef.current
    ) {
      return;
    }
    appliedRequestKeyRef.current = anchorRequestKey;

    if (scrollMode === "code" || !anchorMessageId) {
      controller.jumpToLatest("instant");
      return;
    }

    // The message element may land a frame later than the state bump.
    let attempts = 0;
    let rafId: number | null = null;
    const tryAnchor = () => {
      if (controller.anchorToMessage(anchorMessageId)) return;
      if (attempts >= MAX_ANCHOR_RETRIES) return;
      attempts += 1;
      rafId = requestAnimationFrame(tryAnchor);
    };
    tryAnchor();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [anchorRequestKey, anchorMessageId, scrollMode, controller]);

  const scrollToBottom = useCallback(() => {
    controller.jumpToLatest("smooth");
  }, [controller]);

  const contextValue = useMemo<ConversationContextValue>(
    () => ({
      contentRef,
      // The jump button targets readers who left the live edge: hidden while
      // near the bottom AND while following (following keeps the view pinned
      // even when growth momentarily outruns the near-bottom band).
      isAtBottom: isAtBottom || isFollowing,
      scrollRef,
      scrollToBottom,
    }),
    [isAtBottom, isFollowing, scrollToBottom]
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
          // Floating circle: raised surface, hairline ring folded into
          // the shadow, 36px.
          "absolute bottom-6 left-[50%] z-10 h-9 w-9 translate-x-[-50%] rounded-full border-none bg-[var(--rowboat-raised)] text-[var(--rowboat-ink-secondary)] shadow-[var(--rowboat-shadow-soft)] transition hover:bg-[var(--rowboat-raised)] hover:text-foreground",
          className
        )}
        aria-label="Scroll to latest message"
        onClick={handleScrollToBottom}
        type="button"
        variant="ghost"
        {...props}
      >
        <ArrowDownIcon className="size-4.5" strokeWidth={1.5} />
      </Button>
    )
  );
};
