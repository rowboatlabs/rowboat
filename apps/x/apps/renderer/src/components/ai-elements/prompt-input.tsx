"use client";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ChatStatus, FileUIPart } from "ai";
import {
  CornerDownLeftIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useMentionDetection } from "@/hooks/use-mention-detection";
import { MentionPopover, type MentionAnchor } from "@/components/mention-popover";
import { toKnowledgePath } from "@/lib/wiki-links";
import { getMentionHighlightSegments } from "@/lib/mention-highlights";
import {
  EMPTY_SPACES_MENTION_TARGETS,
  mentionLabelsFor,
  mentionTargetLabel,
  type MemberMentionTarget,
  type MentionSources,
  type MentionTarget,
  type SpaceMentionTarget,
  type SpacesMentionTargets,
} from "@/lib/mention-targets";
import {
  type ChangeEvent,
  type ChangeEventHandler,
  Children,
  type ClipboardEventHandler,
  type ComponentProps,
  createContext,
  type FormEvent,
  type FormEventHandler,
  Fragment,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ============================================================================
// Provider Context & Types
// ============================================================================

const EMPTY_FILES: string[] = [];

export type AttachmentsContext = {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

// What the composer's @ menu can attach to a message. Every kind carries
// `displayName` — the text after "@" in the textarea — so the highlight and
// backspace-as-one-token logic treat them alike. A file becomes an
// attachment content part on send; a space or a person rides
// userMessageContext.spaceMentions (@x/shared message.ts) with its ids.
export type FileMention = {
  kind: 'file';
  id: string;
  path: string;         // "knowledge/notes.md"
  displayName: string;  // "notes"
  lineNumber?: number;  // 1-indexed source-line reference (for editor-context mentions)
};

export type SpaceMention = {
  kind: 'space';
  id: string;
  orgId: string;
  orgName: string;
  spaceId: string;
  displayName: string;  // the space's name
};

export type MemberMention = {
  kind: 'member';
  id: string;
  orgId: string;
  orgName: string;
  memberId: string;
  displayName: string;  // the person's display name
};

export type Mention = FileMention | SpaceMention | MemberMention;

/** A mention before the provider assigns its id. */
export type MentionInput =
  | Omit<FileMention, 'id'>
  | Omit<SpaceMention, 'id'>
  | Omit<MemberMention, 'id'>;

/** Same target, whatever the id: the dedupe rule for addMention. */
function sameMentionTarget(a: MentionInput, b: MentionInput): boolean {
  if (a.kind === 'file' && b.kind === 'file') return a.path === b.path && a.lineNumber === b.lineNumber;
  if (a.kind === 'space' && b.kind === 'space') return a.orgId === b.orgId && a.spaceId === b.spaceId;
  if (a.kind === 'member' && b.kind === 'member') return a.orgId === b.orgId && a.memberId === b.memberId;
  return false;
}

export type MentionsContext = {
  mentions: Mention[];
  addMention: (mention: MentionInput) => void;
  removeMention: (id: string) => void;
  clearMentions: () => void;
};

export type TextInputContext = {
  value: string;
  setInput: (v: string) => void;
  clear: () => void;
};

export type PromptInputControllerProps = {
  textInput: TextInputContext;
  attachments: AttachmentsContext;
  mentions: MentionsContext;
  /** INTERNAL: Allows PromptInput to register its file textInput + "open" callback */
  __registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void
  ) => void;
};

const PromptInputController = createContext<PromptInputControllerProps | null>(
  null
);
const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(
  null
);
const ProviderMentionsContext = createContext<MentionsContext | null>(null);

export const usePromptInputController = () => {
  const ctx = useContext(PromptInputController);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use usePromptInputController()."
    );
  }
  return ctx;
};

// Optional variants (do NOT throw). Useful for dual-mode components.
const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

export const useProviderAttachments = () => {
  const ctx = useContext(ProviderAttachmentsContext);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use useProviderAttachments()."
    );
  }
  return ctx;
};

const useOptionalProviderAttachments = () =>
  useContext(ProviderAttachmentsContext);

export const useProviderMentions = () => {
  const ctx = useContext(ProviderMentionsContext);
  if (!ctx) {
    throw new Error(
      "Wrap your component inside <PromptInputProvider> to use useProviderMentions()."
    );
  }
  return ctx;
};

const useOptionalProviderMentions = () => useContext(ProviderMentionsContext);

// Everything the @ menu can name: knowledge files (with the tree's open and
// recent files ranked first) plus the Spaces targets — the shared spaces the
// user is in and the people they can DM (empty with Spaces dark).
export type KnowledgeFilesContext = {
  files: string[];
  recentFiles: string[];
  visibleFiles: string[];
  spaces: SpaceMentionTarget[];
  members: MemberMentionTarget[];
};

const ProviderKnowledgeFilesContext = createContext<KnowledgeFilesContext | null>(null);

export const useProviderKnowledgeFiles = () => {
  return useContext(ProviderKnowledgeFilesContext);
};

export type PromptInputProviderProps = PropsWithChildren<{
  initialInput?: string;
  knowledgeFiles?: string[];
  recentFiles?: string[];
  visibleFiles?: string[];
  /** The Spaces half of the @ menu — see useSpacesMentionTargets. */
  mentionTargets?: SpacesMentionTargets;
}>;

/**
 * Optional global provider that lifts PromptInput state outside of PromptInput.
 * If you don't use it, PromptInput stays fully self-managed.
 */
export function PromptInputProvider({
  initialInput: initialTextInput = "",
  knowledgeFiles = [],
  recentFiles = [],
  visibleFiles = [],
  mentionTargets = EMPTY_SPACES_MENTION_TARGETS,
  children,
}: PromptInputProviderProps) {
  // ----- textInput state
  const [textInput, setTextInput] = useState(initialTextInput);
  const clearInput = useCallback(() => setTextInput(""), []);

  // ----- attachments state (global when wrapped)
  const [attachmentFiles, setAttachmentFiles] = useState<
    (FileUIPart & { id: string })[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef<() => void>(() => {});

  const add = useCallback((files: File[] | FileList) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) {
      return;
    }

    setAttachmentFiles((prev) =>
      prev.concat(
        incoming.map((file) => ({
          id: nanoid(),
          type: "file" as const,
          url: URL.createObjectURL(file),
          mediaType: file.type,
          filename: file.name,
        }))
      )
    );
  }, []);

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      const found = prev.find((f) => f.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const f of prev) {
        if (f.url) {
          URL.revokeObjectURL(f.url);
        }
      }
      return [];
    });
  }, []);

  // Keep a ref to attachments for cleanup on unmount (avoids stale closure)
  const attachmentsRef = useRef(attachmentFiles);
  attachmentsRef.current = attachmentFiles;

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      for (const f of attachmentsRef.current) {
        if (f.url) {
          URL.revokeObjectURL(f.url);
        }
      }
    };
  }, []);

  const openFileDialog = useCallback(() => {
    openRef.current?.();
  }, []);

  const attachments = useMemo<AttachmentsContext>(
    () => ({
      files: attachmentFiles,
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog]
  );

  // ----- mentions state (the @ menu's picks: files, spaces, people)
  const [mentionsList, setMentionsList] = useState<Mention[]>([]);

  const addMention = useCallback((mention: MentionInput) => {
    setMentionsList((prev) => {
      // Avoid duplicates (a file at a specific line is distinct from the whole file)
      if (prev.some((m) => sameMentionTarget(m, mention))) {
        return prev;
      }
      return [...prev, { ...mention, id: nanoid() } as Mention];
    });
  }, []);

  const removeMention = useCallback((id: string) => {
    setMentionsList((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearMentions = useCallback(() => {
    setMentionsList([]);
  }, []);

  const mentions = useMemo<MentionsContext>(
    () => ({
      mentions: mentionsList,
      addMention,
      removeMention,
      clearMentions,
    }),
    [mentionsList, addMention, removeMention, clearMentions]
  );

  const __registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current;
      openRef.current = open;
    },
    []
  );

  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      textInput: {
        value: textInput,
        setInput: setTextInput,
        clear: clearInput,
      },
      attachments,
      mentions,
      __registerFileInput,
    }),
    [textInput, clearInput, attachments, mentions, __registerFileInput]
  );

  const knowledgeFilesContext = useMemo<KnowledgeFilesContext>(
    () => ({
      files: knowledgeFiles,
      recentFiles,
      visibleFiles,
      spaces: mentionTargets.spaces,
      members: mentionTargets.members,
    }),
    [knowledgeFiles, recentFiles, visibleFiles, mentionTargets.spaces, mentionTargets.members]
  );

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        <ProviderMentionsContext.Provider value={mentions}>
          <ProviderKnowledgeFilesContext.Provider value={knowledgeFilesContext}>
            {children}
          </ProviderKnowledgeFilesContext.Provider>
        </ProviderMentionsContext.Provider>
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  );
}

// ============================================================================
// Component Context & Hooks
// ============================================================================

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  // Dual-mode: prefer provider if present, otherwise use local
  const provider = useOptionalProviderAttachments();
  const local = useContext(LocalAttachmentsContext);
  const context = provider ?? local;
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput or PromptInputProvider"
    );
  }
  return context;
};

export type PromptInputAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart & { id: string };
  className?: string;
};

export function PromptInputAttachment({
  data,
  className,
  ...props
}: PromptInputAttachmentProps) {
  const attachments = usePromptInputAttachments();

  const filename = data.filename || "";

  const mediaType =
    data.mediaType?.startsWith("image/") && data.url ? "image" : "file";
  const isImage = mediaType === "image";

  const attachmentLabel = filename || (isImage ? "Image" : "Attachment");

  return (
    <PromptInputHoverCard>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            "group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-sm transition-all hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
            className
          )}
          key={data.id}
          {...props}
        >
          <div className="relative size-5 shrink-0">
            <div className="absolute inset-0 flex size-5 items-center justify-center overflow-hidden rounded bg-background transition-opacity group-hover:opacity-0">
              {isImage ? (
                <img
                  alt={filename || "attachment"}
                  className="size-5 object-cover"
                  height={20}
                  src={data.url}
                  width={20}
                />
              ) : (
                <div className="flex size-5 items-center justify-center text-muted-foreground">
                  <PaperclipIcon className="size-3" />
                </div>
              )}
            </div>
            <Button
              aria-label="Remove attachment"
              className="absolute inset-0 size-5 cursor-pointer rounded p-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 [&>svg]:size-2.5"
              onClick={(e) => {
                e.stopPropagation();
                attachments.remove(data.id);
              }}
              type="button"
              variant="ghost"
            >
              <XIcon />
              <span className="sr-only">Remove</span>
            </Button>
          </div>

          <span className="flex-1 truncate">{attachmentLabel}</span>
        </div>
      </HoverCardTrigger>
      <PromptInputHoverCardContent className="w-auto p-2">
        <div className="w-auto space-y-3">
          {isImage && (
            <div className="flex max-h-96 w-96 items-center justify-center overflow-hidden rounded-md border">
              <img
                alt={filename || "attachment preview"}
                className="max-h-full max-w-full object-contain"
                height={384}
                src={data.url}
                width={448}
              />
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1 space-y-1 px-0.5">
              <h4 className="truncate font-semibold text-sm leading-none">
                {filename || (isImage ? "Image" : "Attachment")}
              </h4>
              {data.mediaType && (
                <p className="truncate font-mono text-muted-foreground text-xs">
                  {data.mediaType}
                </p>
              )}
            </div>
          </div>
        </div>
      </PromptInputHoverCardContent>
    </PromptInputHoverCard>
  );
}

export type PromptInputAttachmentsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children: (attachment: FileUIPart & { id: string }) => ReactNode;
};

export function PromptInputAttachments({
  children,
  className,
  ...props
}: PromptInputAttachmentsProps) {
  const attachments = usePromptInputAttachments();

  if (!attachments.files.length) {
    return null;
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2 p-3 w-full", className)}
      {...props}
    >
      {attachments.files.map((file) => (
        <Fragment key={file.id}>{children(file)}</Fragment>
      ))}
    </div>
  );
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "Add photos or files",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  return (
    <DropdownMenuItem
      {...props}
      onSelect={(e) => {
        e.preventDefault();
        attachments.openFileDialog();
      }}
    >
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  );
};

export type PromptInputMessage = {
  text: string;
  files: FileUIPart[];
};

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  accept?: string; // e.g., "image/*" or leave undefined for any
  multiple?: boolean;
  // When true, accepts drops anywhere on document. Default false (opt-in).
  globalDrop?: boolean;
  // Render a hidden input with given name and keep it in sync for native form posts. Default false.
  syncHiddenInput?: boolean;
  // Minimal constraints
  maxFiles?: number;
  maxFileSize?: number; // bytes
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  // Try to use a provider controller if present
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;

  // Refs
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  // ----- Local attachments (only used when no provider)
  const [items, setItems] = useState<(FileUIPart & { id: string })[]>([]);
  const files = usingProvider ? controller.attachments.files : items;

  // Keep a ref to files for cleanup on unmount (avoids stale closure)
  const filesRef = useRef(files);
  filesRef.current = files;

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") {
        return true;
      }

      const patterns = accept
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      return patterns.some((pattern) => {
        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -1); // e.g: image/* -> image/
          return f.type.startsWith(prefix);
        }
        return f.type === pattern;
      });
    },
    [accept]
  );

  const addLocal = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = Array.from(fileList);
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return;
      }
      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return;
      }

      setItems((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }
        const next: (FileUIPart & { id: string })[] = [];
        for (const file of capped) {
          next.push({
            id: nanoid(),
            type: "file",
            url: URL.createObjectURL(file),
            mediaType: file.type,
            filename: file.name,
          });
        }
        return prev.concat(next);
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError]
  );

  const removeLocal = useCallback(
    (id: string) =>
      setItems((prev) => {
        const found = prev.find((file) => file.id === id);
        if (found?.url) {
          URL.revokeObjectURL(found.url);
        }
        return prev.filter((file) => file.id !== id);
      }),
    []
  );

  const clearLocal = useCallback(
    () =>
      setItems((prev) => {
        for (const file of prev) {
          if (file.url) {
            URL.revokeObjectURL(file.url);
          }
        }
        return [];
      }),
    []
  );

  const add = usingProvider ? controller.attachments.add : addLocal;
  const remove = usingProvider ? controller.attachments.remove : removeLocal;
  const clear = usingProvider ? controller.attachments.clear : clearLocal;
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : openFileDialogLocal;

  // Let provider know about our hidden file input so external menus can call openFileDialog()
  useEffect(() => {
    if (!usingProvider) return;
    controller.__registerFileInput(inputRef, () => inputRef.current?.click());
  }, [usingProvider, controller]);

  // Note: File input cannot be programmatically set for security reasons
  // The syncHiddenInput prop is no longer functional
  useEffect(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);

  // Attach drop handlers on nearest form and document (opt-in)
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    if (globalDrop) return // when global drop is on, let the document-level handler own drops

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(() => {
    if (!globalDrop) return;

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(
    () => () => {
      if (!usingProvider) {
        for (const f of filesRef.current) {
          if (f.url) URL.revokeObjectURL(f.url);
        }
      }
    },
     
    [usingProvider]
  );

  const handleChange: ChangeEventHandler<HTMLInputElement> = (event) => {
    if (event.currentTarget.files) {
      add(event.currentTarget.files);
    }
    // Reset input value to allow selecting files that were previously removed
    event.currentTarget.value = "";
  };

  const convertBlobUrlToDataUrl = async (
    url: string
  ): Promise<string | null> => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const ctx = useMemo<AttachmentsContext>(
    () => ({
      files: files.map((item) => ({ ...item, id: item.id })),
      add,
      remove,
      clear,
      openFileDialog,
      fileInputRef: inputRef,
    }),
    [files, add, remove, clear, openFileDialog]
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const text = usingProvider
      ? controller.textInput.value
      : (() => {
          const formData = new FormData(form);
          return (formData.get("message") as string) || "";
        })();

    // Reset form immediately after capturing text to avoid race condition
    // where user input during async blob conversion would be lost
    if (!usingProvider) {
      form.reset();
    }

    // Convert blob URLs to data URLs asynchronously
    Promise.all(
      files.map(async ({ id, ...item }) => {
        if (item.url && item.url.startsWith("blob:")) {
          const dataUrl = await convertBlobUrlToDataUrl(item.url);
          // If conversion failed, keep the original blob URL
          return {
            ...item,
            url: dataUrl ?? item.url,
          };
        }
        return item;
      })
    )
      .then((convertedFiles: FileUIPart[]) => {
        try {
          const result = onSubmit({ text, files: convertedFiles }, event);

          // Handle both sync and async onSubmit
          if (result instanceof Promise) {
            result
              .then(() => {
                clear();
                if (usingProvider) {
                  controller.textInput.clear();
                }
              })
              .catch(() => {
                // Don't clear on error - user may want to retry
              });
          } else {
            // Sync function completed without throwing, clear attachments
            clear();
            if (usingProvider) {
              controller.textInput.clear();
            }
          }
        } catch {
          // Don't clear on error - user may want to retry
        }
      })
      .catch(() => {
        // Don't clear on error - user may want to retry
      });
  };

  // Render with or without local provider
  const inner = (
    <>
      <input
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleChange}
        ref={inputRef}
        title="Upload files"
        type="file"
      />
      <form
        className={cn("w-full", className)}
        onSubmit={handleSubmit}
        ref={formRef}
        {...props}
      >
        <InputGroup className="overflow-hidden">{children}</InputGroup>
      </form>
    </>
  );

  return usingProvider ? (
    inner
  ) : (
    <LocalAttachmentsContext.Provider value={ctx}>
      {inner}
    </LocalAttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
> & {
  autoFocus?: boolean;
  focusTrigger?: unknown; // When this value changes, focus the textarea
};

export const PromptInputTextarea = ({
  onChange,
  className,
  placeholder = "What would you like to know?",
  onKeyDown: externalOnKeyDown,
  autoFocus = false,
  focusTrigger,
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const mentionsCtx = useOptionalProviderMentions();
  const knowledgeFilesCtx = useProviderKnowledgeFiles();
  const [isComposing, setIsComposing] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea when requested or when focusTrigger changes
  useEffect(() => {
    if (autoFocus || focusTrigger !== undefined) {
      // Small delay to ensure the element is fully mounted and visible
      const timer = setTimeout(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        try {
          textarea.focus({ preventScroll: true });
        } catch {
          textarea.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, focusTrigger]);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const currentValue = controller?.textInput.value ?? "";
  const knowledgeFiles = knowledgeFilesCtx?.files ?? EMPTY_FILES;
  const recentFiles = knowledgeFilesCtx?.recentFiles ?? EMPTY_FILES;
  const visibleFiles = knowledgeFilesCtx?.visibleFiles ?? EMPTY_FILES;
  const spaceTargets = knowledgeFilesCtx?.spaces ?? EMPTY_SPACES_MENTION_TARGETS.spaces;
  const memberTargets = knowledgeFilesCtx?.members ?? EMPTY_SPACES_MENTION_TARGETS.members;

  // Everything "@" can name here: files, spaces, people (mention-targets.ts).
  const mentionSources = useMemo<MentionSources>(
    () => ({ files: knowledgeFiles, recentFiles, visibleFiles, spaces: spaceTargets, members: memberTargets }),
    [knowledgeFiles, recentFiles, visibleFiles, spaceTargets, memberTargets]
  );
  const mentionsEnabled =
    knowledgeFiles.length > 0 || spaceTargets.length > 0 || memberTargets.length > 0;

  // Build mention labels for highlighting (handles multi-word names like "AI Agents")
  const mentionLabels = useMemo(() => mentionLabelsFor(mentionSources), [mentionSources]);

  const { activeMention } = useMentionDetection(
    textareaRef,
    currentValue,
    mentionsEnabled
  );

  // The @ menu sits above the composer box (Slack's placement), never over
  // the text: measured live from the nearest composer, or from this wrapper
  // when the textarea is hosted bare.
  const mentionAnchorRef = useRef<MentionAnchor>({
    getBoundingClientRect: () =>
      (containerRef.current?.closest<HTMLElement>("[data-mention-anchor]") ?? containerRef.current)
        ?.getBoundingClientRect() ?? new DOMRect(),
  });

  // Escape-dismissal: `open` derives from the text, so closing needs real
  // state. Dismissed stays true for the current mention; a fresh "@" (or
  // ending the mention) re-arms the popover.
  const [mentionDismissed, setMentionDismissed] = useState(false);
  useEffect(() => {
    if (!activeMention) setMentionDismissed(false);
  }, [activeMention?.triggerIndex, activeMention]);

  // Use proper regex-based highlight segmentation that handles multi-word names
  const mentionHighlights = useMemo(
    () => getMentionHighlightSegments(currentValue, activeMention, mentionLabels),
    [currentValue, activeMention, mentionLabels]
  );

  // Sync highlight overlay scroll with textarea
  const syncHighlightScroll = useCallback(() => {
    const textarea = textareaRef.current;
    const highlight = highlightRef.current;
    if (!textarea || !highlight) return;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }, []);

  useEffect(() => {
    syncHighlightScroll();
  }, [currentValue, mentionHighlights.hasHighlights, syncHighlightScroll]);

  const handleMentionSelect = useCallback(
    (target: MentionTarget) => {
      if (!controller || !activeMention) return;

      // Calculate the text before and after the @query
      const currentText = controller.textInput.value;
      const beforeAt = currentText.substring(0, activeMention.triggerIndex);
      const afterQuery = currentText.substring(
        activeMention.triggerIndex + 1 + activeMention.query.length
      );

      // Replace @query with @label followed by a space
      const displayName = mentionTargetLabel(target);
      const newText = `${beforeAt}@${displayName} ${afterQuery}`;
      controller.textInput.setInput(newText);

      // Record what the label stands for. @rowboat is a literal insertion —
      // it addresses the assistant, nothing to attach.
      switch (target.kind) {
        case "file": {
          const fullPath = toKnowledgePath(target.path);
          if (fullPath && mentionsCtx) {
            mentionsCtx.addMention({ kind: "file", path: fullPath, displayName });
          }
          break;
        }
        case "space":
          mentionsCtx?.addMention({
            kind: "space",
            orgId: target.orgId,
            orgName: target.orgName,
            spaceId: target.spaceId,
            displayName,
          });
          break;
        case "member":
          mentionsCtx?.addMention({
            kind: "member",
            orgId: target.orgId,
            orgName: target.orgName,
            memberId: target.memberId,
            displayName,
          });
          break;
        case "rowboat":
          break;
      }

      // Focus back on textarea
      textareaRef.current?.focus();
    },
    [controller, activeMention, mentionsCtx]
  );

  const handleMentionClose = useCallback(() => {
    setMentionDismissed(true);
  }, []);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // If mention popover is open, let it handle navigation keys. Prevent the
    // browser defaults here too: in the frame between "@" appearing and the
    // popover's document listener attaching, an early Tab would otherwise
    // move focus out of the textarea entirely.
    if (activeMention && !mentionDismissed && ["ArrowDown", "ArrowUp", "Tab"].includes(e.key)) {
      e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      // If mention popover is open, Enter should select the item
      if (activeMention) {
        return;
      }

      if (isComposing || e.nativeEvent.isComposing) {
        return;
      }
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();

      // Check if the submit button is disabled before submitting
      const form = e.currentTarget.form;
      const submitButton = form?.querySelector(
        'button[type="submit"]'
      ) as HTMLButtonElement | null;
      if (submitButton?.disabled) {
        return;
      }

      form?.requestSubmit();
    }

    // Handle backspace to delete entire mention at once
    if (e.key === "Backspace") {
      const textarea = e.currentTarget;
      const cursorPos = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const textValue = controller?.textInput.value ?? textarea.value;

      // Only handle if no text is selected (cursor is at a single position)
      if (cursorPos === selectionEnd) {
        // Check if cursor is right after a mention
        for (const label of mentionLabels) {
          const mentionText = `@${label}`;
          const startPos = cursorPos - mentionText.length;
          if (startPos >= 0) {
            const textBefore = textValue.substring(startPos, cursorPos);
            if (textBefore === mentionText) {
              // Check if it's at word boundary (start of string or preceded by whitespace)
              if (startPos === 0 || /\s/.test(textValue[startPos - 1])) {
                e.preventDefault();
                const newText = textValue.substring(0, startPos) + textValue.substring(cursorPos);
                if (controller) {
                  controller.textInput.setInput(newText);
                } else {
                  // Fallback: directly set textarea value and trigger change
                  textarea.value = newText;
                  textarea.dispatchEvent(new Event('input', { bubbles: true }));
                }
                // Remove the mention from state
                if (mentionsCtx) {
                  const mentionToRemove = mentionsCtx.mentions.find(m => m.displayName === label);
                  if (mentionToRemove) {
                    mentionsCtx.removeMention(mentionToRemove.id);
                  }
                }
                // Set cursor position after React updates
                setTimeout(() => {
                  textarea.selectionStart = startPos;
                  textarea.selectionEnd = startPos;
                }, 0);
                return;
              }
            }
          }
        }
      }
    }

    // Remove last attachment when Backspace is pressed and textarea is empty
    if (
      e.key === "Backspace" &&
      e.currentTarget.value === "" &&
      attachments.files.length > 0
    ) {
      e.preventDefault();
      const lastAttachment = attachments.files.at(-1);
      if (lastAttachment) {
        attachments.remove(lastAttachment.id);
      }
    }

    // Close mention popover on Escape (the popover's capture listener does
    // the closing; swallow it here so outer Escapes don't also fire).
    if (e.key === "Escape" && activeMention && !mentionDismissed) {
      return;
    }

    // Call external handler if provided
    externalOnKeyDown?.(e);
  };

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const items = event.clipboardData?.items;

    if (!items) {
      return;
    }

    const files: File[] = [];

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      attachments.add(files);
    }
  };

  const controlledProps = controller
    ? {
        value: controller.textInput.value,
        onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
          controller.textInput.setInput(e.currentTarget.value);
          onChange?.(e);
        },
      }
    : {
        onChange,
      };

  return (
    <div ref={containerRef} className="relative flex flex-1 min-w-0">
      {mentionHighlights.hasHighlights && (
        <div
          ref={highlightRef}
          aria-hidden="true"
          dir="auto"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden whitespace-pre-wrap break-words text-[15px] leading-6 text-transparent"
        >
          {mentionHighlights.segments.map((segment, index) =>
            segment.highlighted ? (
              <span
                key={`mention-${index}`}
                className="rounded bg-primary/20 text-transparent [box-decoration-break:clone] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15),-3px_0_0_hsl(var(--primary)/0.2),3px_0_0_hsl(var(--primary)/0.2),0_-2px_0_hsl(var(--primary)/0.2),0_2px_0_hsl(var(--primary)/0.2)]"
              >
                {segment.text}
              </span>
            ) : (
              <span key={`text-${index}`}>{segment.text}</span>
            )
          )}
        </div>
      )}
      <InputGroupTextarea
        ref={textareaRef}
        dir="auto"
        className={cn(
          // composer text matches message prose (15px). The highlight
          // overlay above must keep identical font metrics or mention boxes
          // drift from the caret.
          "relative z-10 !p-0 field-sizing-content max-h-48 min-h-10 text-[15px] leading-6",
          className
        )}
        name="message"
        onCompositionEnd={() => setIsComposing(false)}
        onCompositionStart={() => setIsComposing(true)}
        onKeyDown={handleKeyDown}
        onScroll={syncHighlightScroll}
        onPaste={handlePaste}
        placeholder={placeholder}
        {...props}
        {...controlledProps}
      />
      {mentionsEnabled && (
        <MentionPopover
          sources={mentionSources}
          query={activeMention?.query ?? ""}
          anchorRef={mentionAnchorRef}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
          open={Boolean(activeMention) && !mentionDismissed}
        />
      )}
    </div>
  );
};

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("order-first flex-wrap gap-1", className)}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
);

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>;

export const PromptInputButton = ({
  variant = "ghost",
  className,
  size,
  ...props
}: PromptInputButtonProps) => {
  const newSize =
    size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm");

  return (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton className={className} {...props}>
      {children ?? <PlusIcon className="size-4" />}
    </PromptInputButton>
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropdownMenuContent
>;
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropdownMenuItem
>;
export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem className={cn(className)} {...props} />
);

// Note: Actions that perform side-effects (like opening a file dialog)
// are provided in opt-in modules (e.g., prompt-input-attachments).

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  children,
  ...props
}: PromptInputSubmitProps) => {
  let Icon = <CornerDownLeftIcon className="size-4" />;

  if (status === "submitted") {
    Icon = <Loader2Icon className="size-4 animate-spin" />;
  } else if (status === "streaming") {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === "error") {
    Icon = <XIcon className="size-4" />;
  }

  return (
    <InputGroupButton
      aria-label="Submit"
      className={cn(className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );
};

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult:
    | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any)
    | null;
  onerror:
    | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any)
    | null;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

type SpeechRecognitionResultList = {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionResult = {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
};

type SpeechRecognitionAlternative = {
  transcript: string;
  confidence: number;
};

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

declare global {
  interface Window {
    SpeechRecognition: {
      new (): SpeechRecognition;
    };
    webkitSpeechRecognition: {
      new (): SpeechRecognition;
    };
  }
}

export type PromptInputSpeechButtonProps = ComponentProps<
  typeof PromptInputButton
> & {
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onTranscriptionChange?: (text: string) => void;
};

export const PromptInputSpeechButton = ({
  className,
  textareaRef,
  onTranscriptionChange,
  ...props
}: PromptInputSpeechButtonProps) => {
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(
    null
  );
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    ) {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      const speechRecognition = new SpeechRecognition();

      speechRecognition.continuous = true;
      speechRecognition.interimResults = true;
      speechRecognition.lang = "en-US";

      speechRecognition.onstart = () => {
        setIsListening(true);
      };

      speechRecognition.onend = () => {
        setIsListening(false);
      };

      speechRecognition.onresult = (event) => {
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0]?.transcript ?? "";
          }
        }

        if (finalTranscript && textareaRef?.current) {
          const textarea = textareaRef.current;
          const currentValue = textarea.value;
          const newValue =
            currentValue + (currentValue ? " " : "") + finalTranscript;

          textarea.value = newValue;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          onTranscriptionChange?.(newValue);
        }
      };

      speechRecognition.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        setIsListening(false);
      };

      recognitionRef.current = speechRecognition;
      setRecognition(speechRecognition);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [textareaRef, onTranscriptionChange]);

  const toggleListening = useCallback(() => {
    if (!recognition) {
      return;
    }

    if (isListening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  }, [recognition, isListening]);

  return (
    <PromptInputButton
      className={cn(
        "relative transition-all duration-200",
        isListening && "animate-pulse bg-accent text-accent-foreground",
        className
      )}
      disabled={!recognition}
      onClick={toggleListening}
      {...props}
    >
      <MicIcon className="size-4" />
    </PromptInputButton>
  );
};

export type PromptInputSelectProps = ComponentProps<typeof Select>;

export const PromptInputSelect = (props: PromptInputSelectProps) => (
  <Select {...props} />
);

export type PromptInputSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const PromptInputSelectTrigger = ({
  className,
  ...props
}: PromptInputSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      "border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors",
      "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
      className
    )}
    {...props}
  />
);

export type PromptInputSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const PromptInputSelectContent = ({
  className,
  ...props
}: PromptInputSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
);

export type PromptInputSelectItemProps = ComponentProps<typeof SelectItem>;

export const PromptInputSelectItem = ({
  className,
  ...props
}: PromptInputSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
);

export type PromptInputSelectValueProps = ComponentProps<typeof SelectValue>;

export const PromptInputSelectValue = ({
  className,
  ...props
}: PromptInputSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
);

export type PromptInputHoverCardProps = ComponentProps<typeof HoverCard>;

export const PromptInputHoverCard = ({
  openDelay = 0,
  closeDelay = 0,
  ...props
}: PromptInputHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
);

export type PromptInputHoverCardTriggerProps = ComponentProps<
  typeof HoverCardTrigger
>;

export const PromptInputHoverCardTrigger = (
  props: PromptInputHoverCardTriggerProps
) => <HoverCardTrigger {...props} />;

export type PromptInputHoverCardContentProps = ComponentProps<
  typeof HoverCardContent
>;

export const PromptInputHoverCardContent = ({
  align = "start",
  ...props
}: PromptInputHoverCardContentProps) => (
  <HoverCardContent align={align} {...props} />
);

export type PromptInputTabsListProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabsList = ({
  className,
  ...props
}: PromptInputTabsListProps) => <div className={cn(className)} {...props} />;

export type PromptInputTabProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTab = ({
  className,
  ...props
}: PromptInputTabProps) => <div className={cn(className)} {...props} />;

export type PromptInputTabLabelProps = HTMLAttributes<HTMLHeadingElement>;

export const PromptInputTabLabel = ({
  className,
  ...props
}: PromptInputTabLabelProps) => (
  <h3
    className={cn(
      "mb-2 px-3 font-medium text-muted-foreground text-xs",
      className
    )}
    {...props}
  />
);

export type PromptInputTabBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabBody = ({
  className,
  ...props
}: PromptInputTabBodyProps) => (
  <div className={cn("space-y-1", className)} {...props} />
);

export type PromptInputTabItemProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTabItem = ({
  className,
  ...props
}: PromptInputTabItemProps) => (
  <div
    className={cn(
      "flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent",
      className
    )}
    {...props}
  />
);

export type PromptInputCommandProps = ComponentProps<typeof Command>;

export const PromptInputCommand = ({
  className,
  ...props
}: PromptInputCommandProps) => <Command className={cn(className)} {...props} />;

export type PromptInputCommandInputProps = ComponentProps<typeof CommandInput>;

export const PromptInputCommandInput = ({
  className,
  ...props
}: PromptInputCommandInputProps) => (
  <CommandInput className={cn(className)} {...props} />
);

export type PromptInputCommandListProps = ComponentProps<typeof CommandList>;

export const PromptInputCommandList = ({
  className,
  ...props
}: PromptInputCommandListProps) => (
  <CommandList className={cn(className)} {...props} />
);

export type PromptInputCommandEmptyProps = ComponentProps<typeof CommandEmpty>;

export const PromptInputCommandEmpty = ({
  className,
  ...props
}: PromptInputCommandEmptyProps) => (
  <CommandEmpty className={cn(className)} {...props} />
);

export type PromptInputCommandGroupProps = ComponentProps<typeof CommandGroup>;

export const PromptInputCommandGroup = ({
  className,
  ...props
}: PromptInputCommandGroupProps) => (
  <CommandGroup className={cn(className)} {...props} />
);

export type PromptInputCommandItemProps = ComponentProps<typeof CommandItem>;

export const PromptInputCommandItem = ({
  className,
  ...props
}: PromptInputCommandItemProps) => (
  <CommandItem className={cn(className)} {...props} />
);

export type PromptInputCommandSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const PromptInputCommandSeparator = ({
  className,
  ...props
}: PromptInputCommandSeparatorProps) => (
  <CommandSeparator className={cn(className)} {...props} />
);
