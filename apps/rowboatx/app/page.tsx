"use client";

import { AppSidebar } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputAttachments,
  PromptInputAttachment,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
  PromptInputHeader,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ai-elements/reasoning";
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from "@/components/ai-elements/artifact";
import { useState, useEffect, useRef, type ReactNode, useCallback } from "react";
import { MicIcon, Save, Loader2, Lock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JsonEditor } from "@/components/json-editor";
import { TiptapMarkdownEditor } from "@/components/tiptap-markdown-editor";
import { MarkdownViewer } from "@/components/markdown-viewer";

interface ChatMessage {
  id: string;
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ToolCall {
  id: string;
  type: 'tool';
  name: string;
  input: unknown;
  result?: unknown;
  status: 'pending' | 'running' | 'completed' | 'error';
  timestamp: number;
}

interface ReasoningBlock {
  id: string;
  type: 'reasoning';
  content: string;
  isStreaming: boolean;
  timestamp: number;
}

type ConversationItem = ChatMessage | ToolCall | ReasoningBlock;

type ResourceKind = "agent" | "config" | "run";

type SelectedResource = {
  kind: ResourceKind;
  name: string;
};

type ToolCallContentPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  arguments: unknown;
};

type RunEvent = {
  type: string;
  [key: string]: unknown;
};

function PageBody() {
  const [apiBase, setApiBase] = useState<string>("http://localhost:3000")
  const streamUrl = "/api/stream";
  const [text, setText] = useState<string>("");
  const [useMicrophone, setUseMicrophone] = useState<boolean>(false);
  const [status, setStatus] = useState<"submitted" | "streaming" | "ready" | "error">("ready");

  // Chat state
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunProcessing, setIsRunProcessing] = useState(false);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>("");
  const [currentReasoning, setCurrentReasoning] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const committedMessageIds = useRef<Set<string>>(new Set());
  const isEmptyConversation =
    conversation.length === 0 && !currentAssistantMessage && !currentReasoning;
  const [selectedResource, setSelectedResource] = useState<SelectedResource | null>(null);
  const [artifactTitle, setArtifactTitle] = useState("");
  const [artifactSubtitle, setArtifactSubtitle] = useState("");
  const [artifactText, setArtifactText] = useState("");
  const [artifactOriginal, setArtifactOriginal] = useState("");
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [artifactReadOnly, setArtifactReadOnly] = useState(false);
  const [artifactFileType, setArtifactFileType] = useState<"json" | "markdown">("json");
  const [agentOptions, setAgentOptions] = useState<string[]>(["copilot"]);
  const [selectedAgent, setSelectedAgent] = useState<string>("copilot");

  const artifactDirty = !artifactReadOnly && artifactText !== artifactOriginal;
  const stripExtension = (name: string) => name.replace(/\.[^/.]+$/, "");
  const detectFileType = (name: string): "json" | "markdown" =>
    name.toLowerCase().match(/\.(md|markdown)$/) ? "markdown" : "json";
  
  useEffect(() => {
    setApiBase(window.config.apiBase);
  }, []);

  const requestJson = useCallback(async (
    url: string,
    options?: (RequestInit & { allow404?: boolean }) | undefined
  ) => {
    const fullUrl = new URL(url, apiBase).toString();
    console.log('fullUrl', fullUrl);
    const { allow404, ...rest } = options || {};
    const res = await fetch(fullUrl, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(rest.headers || {}),
      },
    });

    const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
    const isJson = contentType.includes("application/json");
    const text = await res.text();

    if (!res.ok) {
      if (res.status === 404 && allow404) return null;
      if (isJson) {
        try {
          const errObj = JSON.parse(text);
          const errMsg =
            typeof errObj === "string"
              ? errObj
              : errObj?.message || errObj?.error || JSON.stringify(errObj);
          throw new Error(errMsg || `Request failed: ${res.status} ${res.statusText}`);
        } catch {
          /* fall through to generic error */
        }
      }
      if (res.status === 404) {
        throw new Error("Resource not found on the CLI backend (404)");
      }
      throw new Error(`Request failed: ${res.status} ${res.statusText}`);
    }

    if (!text) return null;
    if (!isJson) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }, [apiBase]);

  const renderPromptInput = () => (
    <PromptInput globalDrop multiple onSubmit={handleSubmit}>
      <PromptInputHeader>
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
      </PromptInputHeader>
      <PromptInputBody>
        <PromptInputTextarea
          onChange={(event) => setText(event.target.value)}
          value={text}
          placeholder="Ask me anything..."
          className="min-h-[46px] max-h-[200px]"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <PromptInputButton
            onClick={() => setUseMicrophone(!useMicrophone)}
            variant={useMicrophone ? "default" : "ghost"}
          >
            <MicIcon size={16} />
            <span className="sr-only">Microphone</span>
          </PromptInputButton>
          <Select
            value={selectedAgent}
            onValueChange={(value) => setSelectedAgent(value)}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {agentOptions.map((agent) => (
                  <SelectItem key={agent} value={agent}>
                    {agent}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </PromptInputTools>
        <PromptInputSubmit
          disabled={!(text.trim() || status) || status === "streaming"}
          status={status}
        />
      </PromptInputFooter>
    </PromptInput>
  );

  // Connect to SSE stream
  useEffect(() => {
    // Prevent multiple connections
    if (eventSourceRef.current) {
      console.log('⚠️ EventSource already exists, not creating new one');
      return;
    }

    console.log('🔌 Creating new EventSource connection');
    const eventSource = new EventSource(streamUrl);
    eventSourceRef.current = eventSource;

    const handleMessage = (e: MessageEvent) => {
      try {
        const event: RunEvent = JSON.parse(e.data);
        handleEvent(event);
      } catch (error) {
        console.error('Failed to parse event:', error);
      }
    };

    const handleError = (e: Event) => {
      const target = e.target as EventSource;

      // Only log if it's not a normal close
      if (target.readyState === EventSource.CLOSED) {
        console.log('SSE connection closed, will reconnect on next message');
      } else if (target.readyState === EventSource.CONNECTING) {
        console.log('SSE reconnecting...');
      } else {
        console.error('SSE error:', e);
      }
    };

    eventSource.addEventListener('message', handleMessage);
    eventSource.addEventListener('error', handleError);

    return () => {
      console.log('🔌 Closing EventSource connection');
      eventSource.removeEventListener('message', handleMessage);
      eventSource.removeEventListener('error', handleError);
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [streamUrl]);

  // Handle different event types from the copilot
  const handleEvent = (event: RunEvent) => {
    console.log('Event received:', event.type, event);

    switch (event.type) {
      case 'run-processing-start':
        setIsRunProcessing(true);
        setStatus((prev) => (prev === 'error' ? prev : 'streaming'));
        break;

      case 'run-processing-end':
        setIsRunProcessing(false);
        setStatus('ready');
        break;

      case 'start':
        setStatus('streaming');
        setCurrentAssistantMessage('');
        setCurrentReasoning('');
        break;

      case 'llm-stream-event':
        {
          const llmEvent = (event.event as {
            type?: string;
            delta?: string;
            toolCallId?: string;
            toolName?: string;
            input?: unknown;
          }) || {};
          console.log('LLM stream event type:', llmEvent.type);

          if (llmEvent.type === 'reasoning-delta' && llmEvent.delta) {
            setCurrentReasoning(prev => prev + llmEvent.delta);
          } else if (llmEvent.type === 'reasoning-end') {
            // Commit reasoning block if we have content
            setCurrentReasoning(reasoning => {
              if (reasoning) {
                setConversation(prev => [...prev, {
                  id: `reasoning-${Date.now()}`,
                  type: 'reasoning',
                  content: reasoning,
                  isStreaming: false,
                  timestamp: Date.now(),
                }]);
              }
              return '';
            });
          } else if (llmEvent.type === 'text-delta' && llmEvent.delta) {
            setCurrentAssistantMessage(prev => prev + llmEvent.delta);
            setStatus('streaming');
          } else if (llmEvent.type === 'text-end') {
            console.log('TEXT END received - waiting for message event');
          } else if (llmEvent.type === 'tool-call') {
            // Add tool call to conversation immediately
            setConversation(prev => [...prev, {
              id: llmEvent.toolCallId || `tool-${Date.now()}`,
              type: 'tool',
              name: llmEvent.toolName || 'tool',
              input: llmEvent.input,
              status: 'running',
              timestamp: Date.now(),
            }]);
          } else if (llmEvent.type === 'finish-step') {
            console.log('FINISH STEP received - waiting for message event');
          }
        }
        break;

      case 'message': {
        console.log('MESSAGE event received:', event);
        const message = (event.message as { role?: string; content?: unknown }) || {};
        if (message.role !== 'assistant') {
          break;
        }

        if (Array.isArray(message.content)) {
          const toolCalls = message.content.filter(
            (part): part is ToolCallContentPart =>
              (part as ToolCallContentPart)?.type === 'tool-call'
          );
          if (toolCalls.length) {
            setConversation((prev) => {
              let updated: ConversationItem[] = prev.map((item) => {
                if (item.type !== 'tool') return item;
                const match = toolCalls.find(
                  (part) => part.toolCallId === item.id
                );
                return match
                  ? {
                    ...item,
                    name: match.toolName,
                    input: match.arguments,
                    status: 'pending',
                  }
                  : item;
              });

              for (const part of toolCalls) {
                const exists = updated.some(
                  (item) => item.type === 'tool' && item.id === part.toolCallId
                );
                if (!exists) {
                  updated = [
                    ...updated,
                    {
                      id: part.toolCallId,
                      type: 'tool',
                      name: part.toolName,
                      input: part.arguments,
                      status: 'pending',
                      timestamp: Date.now(),
                    },
                  ];
                }
              }
              return updated;
            });
          }
        }

        const messageId =
          typeof event.messageId === "string"
            ? event.messageId
            : `assistant-${Date.now()}`;

        if (committedMessageIds.current.has(messageId)) {
          console.log('⚠️ Message already committed, skipping:', messageId);
          break;
        }

        committedMessageIds.current.add(messageId);

        setCurrentAssistantMessage(currentMsg => {
          console.log('✅ Committing message:', messageId, currentMsg);
          if (currentMsg) {
            setConversation(prev => {
              const exists = prev.some(m => m.id === messageId);
              if (exists) {
                console.log('⚠️ Message ID already in array, skipping:', messageId);
                return prev;
              }
              return [...prev, {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: currentMsg,
                timestamp: Date.now(),
              }];
            });
          }
          return '';
        });
        setStatus('ready');
        console.log('Status set to ready');
        break;
      }

      case 'tool-invocation':
        setConversation(prev => prev.map(item =>
          item.type === 'tool' && (item.id === event.toolCallId || item.name === event.toolName)
            ? { ...item, status: 'running' as const }
            : item
        ));
        break;

      case 'tool-result':
        setConversation(prev => prev.map(item =>
          item.type === 'tool' && (item.id === event.toolCallId || item.name === event.toolName)
            ? { ...item, result: event.result, status: 'completed' as const }
            : item
        ));
        break;

      case 'error':
        // Only set error status for actual errors, not connection issues
        {
          const errorMsg = typeof event.error === "string" ? event.error : "";
          if (errorMsg && !errorMsg.includes('terminated')) {
            setStatus('error');
            console.error('Agent error:', errorMsg);
          } else {
            console.log('Connection error (will auto-reconnect):', errorMsg);
            setStatus('ready');
          }
          setIsRunProcessing(false);
        }
        break;

      default:
        console.log('Unhandled event type:', event.type);
    }
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    const userMessage = message.text || '';

    // Add user message immediately with unique ID
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    setConversation(prev => [...prev, {
      id: userMessageId,
      type: 'message',
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    }]);

    setStatus("submitted");
    setText("");

    try {
      let nextRunId = runId;
      if (!nextRunId) {
        const runData = await requestJson("/runs/new", {
          method: "POST",
          body: JSON.stringify({
            agentId: selectedAgent,
          }),
        });
        nextRunId = runData?.id;
        setRunId(nextRunId);
      }

      if (!nextRunId) {
        throw new Error("Run ID unavailable after creation");
      }

      await requestJson(`/runs/${encodeURIComponent(nextRunId)}/messages/new`, {
        method: "POST",
        body: JSON.stringify({
          message: userMessage,
        }),
      });

      setStatus('streaming');
    } catch (error) {
      console.error('Failed to send message:', error);
      setStatus('error');
      setTimeout(() => setStatus('ready'), 2000);
    }
  };

  useEffect(() => {
    if (!selectedResource) return;
    let cancelled = false;
    const load = async () => {
      setArtifactLoading(true);
      setArtifactError(null);
      try {
        const title = selectedResource.name;
        let subtitle = "";
        let text = "";
        let readOnly = false;
        const detectedType = detectFileType(selectedResource.name);
        setArtifactFileType(detectedType);

        if (selectedResource.kind === "agent") {
          const raw = selectedResource.name;
          const isMarkdown = /\.(md|markdown)$/i.test(raw);

          if (isMarkdown) {
            subtitle = "Agent (Markdown)";
            const response = await fetch(
              `/api/rowboat/agent?file=${encodeURIComponent(raw)}`
            );
            if (!response.ok) {
              if (response.status === 404) {
                text = "";
              } else {
                throw new Error(`Failed to load agent file: ${response.status}`);
              }
            } else {
              const data = await response.json();
              text = data?.content || data?.raw || "";
            }
            setArtifactFileType("markdown");
          } else {
            const id = stripExtension(raw) || raw;
            const data = await requestJson(`/agents/${encodeURIComponent(id)}`);

            subtitle = "Agent";
            text = JSON.stringify(data ?? {}, null, 2);
            setArtifactFileType("json");
          }
        } else if (selectedResource.kind === "config") {
          const lower = selectedResource.name.toLowerCase();
          if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
            // Load markdown file as plain text from local API
            try {
              const response = await fetch(
                `/api/rowboat/config?file=${encodeURIComponent(selectedResource.name)}`
              );
              if (!response.ok) {
                if (response.status === 404) {
                  // File doesn't exist, start with empty content
                  text = "";
                } else {
                  throw new Error(`Failed to load markdown file: ${response.status}`);
                }
              } else {
                const data = await response.json();
                text = data.content || data.raw || "";
              }
              subtitle = "Markdown";
              setArtifactFileType("markdown");
            } catch (error: unknown) {
              const err = error as Error;
              console.error("Error loading markdown file:", error);
              // Show error but still allow editing
              setArtifactError(err?.message || "Failed to load markdown file");
              text = "";
              subtitle = "Markdown";
              setArtifactFileType("markdown");
            }
          } else if (lower.includes("mcp")) {
            const data = await requestJson("/mcp");
            subtitle = "MCP config";
            text = JSON.stringify(data ?? {}, null, 2);
            setArtifactFileType("json");
          } else if (lower.includes("model")) {
            const data = await requestJson("/models");
            subtitle = "Models config";
            text = JSON.stringify(data ?? {}, null, 2);
            setArtifactFileType("json");
          } else {
            // Try to load as JSON by default
            try {
              const data = await requestJson(`/config/${encodeURIComponent(selectedResource.name)}`);
              subtitle = "Config";
              text = JSON.stringify(data ?? {}, null, 2);
              setArtifactFileType("json");
            } catch {
              throw new Error("Unsupported config file");
            }
          }
        } else if (selectedResource.kind === "run") {
          subtitle = "Run (read-only)";
          readOnly = true;
          setArtifactFileType(detectedType);

          const local = await requestJson(
            `/api/rowboat/run?file=${encodeURIComponent(selectedResource.name)}`
          );
          if (local?.parsed) {
            text = JSON.stringify(local.parsed, null, 2);
          } else if (local?.raw) {
            text = local.raw;
          } else {
            text = "";
          }
        }

        if (cancelled) return;
        setArtifactTitle(title);
        setArtifactSubtitle(subtitle);
        setArtifactText(text);
        setArtifactOriginal(text);
        setArtifactReadOnly(readOnly);
      } catch (error: unknown) {
        if (!cancelled) {
          const err = error as Error;
          setArtifactError(err?.message || "Failed to load resource");
          setArtifactText("");
        }
      } finally {
        if (!cancelled) {
          setArtifactLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedResource, requestJson]);

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const res = await fetch("/api/rowboat/summary");
        if (!res.ok) return;
        const data = await res.json();
        const agents = Array.isArray(data.agents)
          ? data.agents.map((a: string) => stripExtension(a))
          : [];
        const merged = Array.from(new Set(["copilot", ...agents]));
        setAgentOptions(merged);
      } catch (e) {
        console.error("Failed to load agent list", e);
      }
    };
    loadAgents();
  }, []);

  useEffect(() => {
    // Changing agent starts a fresh conversation context
    setRunId(null);
    setConversation([]);
    setCurrentAssistantMessage("");
    setCurrentReasoning("");
    setIsRunProcessing(false);
  }, [selectedAgent]);

  const handleSave = async () => {
    if (!selectedResource || artifactReadOnly || !artifactDirty) return;
    setArtifactLoading(true);
    setArtifactError(null);
    try {
      if (selectedResource.kind === "agent") {
        if (artifactFileType === "markdown") {
          const response = await fetch(
            `/api/rowboat/agent?file=${encodeURIComponent(selectedResource.name)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "text/plain" },
              body: artifactText,
            }
          );
          if (!response.ok) {
            throw new Error("Failed to save agent file");
          }
          setArtifactOriginal(artifactText);
        } else {
          const parsed = JSON.parse(artifactText);
          const raw = selectedResource.name;
          const targetId = stripExtension(raw) || raw;

          await requestJson(`/agents/${encodeURIComponent(targetId)}`, {
            method: "PUT",
            body: JSON.stringify(parsed),
          });
          setArtifactOriginal(JSON.stringify(parsed, null, 2));
        }
      } else if (selectedResource.kind === "config") {
        const lower = selectedResource.name.toLowerCase();

        if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
          // Save markdown file as plain text via local API
          const response = await fetch(
            `/api/rowboat/config?file=${encodeURIComponent(selectedResource.name)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "text/plain" },
              body: artifactText,
            }
          );
          if (!response.ok) {
            throw new Error("Failed to save markdown file");
          }
          setArtifactOriginal(artifactText);
        } else {
          // Handle JSON config files
          const parsed = JSON.parse(artifactText);
          const previous = artifactOriginal ? JSON.parse(artifactOriginal) : {};

          if (lower.includes("model")) {
            const newProviders = parsed.providers || {};
            const oldProviders = previous.providers || {};
            const toDelete = Object.keys(oldProviders).filter(
              (name) => !Object.prototype.hasOwnProperty.call(newProviders, name)
            );
            for (const name of toDelete) {
              await requestJson(`/models/providers/${encodeURIComponent(name)}`, {
                method: "DELETE",
              });
            }
            for (const name of Object.keys(newProviders)) {
              await requestJson(`/models/providers/${encodeURIComponent(name)}`, {
                method: "PUT",
                body: JSON.stringify(newProviders[name]),
              });
            }
            if (parsed.defaults) {
              await requestJson("/models/default", {
                method: "PUT",
                body: JSON.stringify(parsed.defaults),
              });
            }
          } else if (lower.includes("mcp")) {
            const newServers = parsed.mcpServers || parsed || {};
            const oldServers = previous.mcpServers || {};
            const toDelete = Object.keys(oldServers).filter(
              (name) => !Object.prototype.hasOwnProperty.call(newServers, name)
            );
            for (const name of toDelete) {
              await requestJson(`/mcp/${encodeURIComponent(name)}`, {
                method: "DELETE",
              });
            }
            for (const name of Object.keys(newServers)) {
              await requestJson(`/mcp/${encodeURIComponent(name)}`, {
                method: "PUT",
                body: JSON.stringify(newServers[name]),
              });
            }
          } else {
            throw new Error("Unsupported config file");
          }
          setArtifactOriginal(JSON.stringify(parsed, null, 2));
        }
      }
    } catch (error: unknown) {
      const err = error as Error;
      setArtifactError(err?.message || "Failed to save changes");
    } finally {
      setArtifactLoading(false);
    }
  };

  return (
    <>
      <AppSidebar onSelectResource={setSelectedResource} />
      <SidebarInset className="h-svh">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="#">RowboatX</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Chat</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 pb-0 md:flex-row">
          <div className="relative flex flex-1 min-w-0 flex-col overflow-hidden">
            {isRunProcessing && (
              <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-muted/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Working...</span>
              </div>
            )}
            {/* Messages area */}
            <Conversation className="flex-1 min-h-0 overflow-y-auto">
              <div className="pointer-events-none sticky bottom-0 z-10 h-16 bg-gradient-to-t from-background via-background/80 to-transparent" />
              <ConversationContent className="!flex !flex-col !items-center !gap-8 !p-4 pt-4 pb-32">
                <div className="w-full max-w-3xl mx-auto space-y-4">

                  {/* Render conversation items in order */}
                  {conversation.map((item) => {
                    if (item.type === 'message') {
                      return (
                        <Message
                          key={item.id}
                          from={item.role}
                        >
                          <MessageContent>
                            <MessageResponse>
                              {item.content}
                            </MessageResponse>
                          </MessageContent>
                        </Message>
                      );
                    } else if (item.type === 'tool') {
                      const stateMap: Record<ToolCall['status'], 'input-streaming' | 'input-available' | 'output-available' | 'output-error'> = {
                        pending: 'input-streaming',
                        running: 'input-available',
                        completed: 'output-available',
                        error: 'output-error',
                      };

                      return (
                        <div key={item.id} className="mb-2">
                          <Tool>
                            <ToolHeader
                              title={item.name}
                              type="tool-call"
                              state={stateMap[item.status] || 'input-streaming'}
                            />
                            <ToolContent>
                              <ToolInput input={item.input} />
                              {item.result != null && (
                                <ToolOutput
                                  output={item.result as ReactNode}
                                  errorText={undefined}
                                />
                              )}
                            </ToolContent>
                          </Tool>
                        </div>
                      );
                    } else if (item.type === 'reasoning') {
                      return (
                        <div key={item.id} className="mb-2">
                          <Reasoning isStreaming={item.isStreaming}>
                            <ReasoningTrigger />
                            <ReasoningContent>
                              {item.content}
                            </ReasoningContent>
                          </Reasoning>
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Streaming reasoning */}
                  {currentReasoning && (
                    <div className="mb-2">
                      <Reasoning isStreaming={true}>
                        <ReasoningTrigger />
                        <ReasoningContent>
                          {currentReasoning}
                        </ReasoningContent>
                      </Reasoning>
                    </div>
                  )}

                  {/* Streaming message */}
                  {currentAssistantMessage && (
                    <Message from="assistant">
                      <MessageContent>
                        <MessageResponse>
                          {currentAssistantMessage}
                        </MessageResponse>
                        <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse" />
                      </MessageContent>
                    </Message>
                  )}
                </div>
              </ConversationContent>
            </Conversation>

            {/* Input area */}
            {isEmptyConversation ? (
              <div className="absolute inset-0 flex items-center justify-center px-4 pb-16">
                <div className="w-full max-w-3xl space-y-3 text-center">
                  <h2 className="text-4xl font-semibold text-foreground/80">
                    RowboatX
                  </h2>
                  {renderPromptInput()}
                </div>
              </div>
            ) : (
              <div className="w-full px-4 pb-5 pt-2">
                <div className="w-full max-w-3xl mx-auto">
                  {renderPromptInput()}
                </div>
              </div>
            )}
          </div>

          {selectedResource && (
            <div className="flex w-full flex-col md:w-[70%] md:max-w-4xl md:shrink-0 min-h-[260px] md:min-h-0 py-5">
              <Artifact className="flex-1 min-h-0 h-full">
                <ArtifactHeader>
                  <div className="flex flex-col">
                    <ArtifactTitle className="truncate">{artifactTitle}</ArtifactTitle>
                    <ArtifactDescription className="text-xs">
                      {artifactSubtitle || selectedResource.kind}
                      {artifactReadOnly && (
                        <span className="ml-2 inline-flex items-center gap-1 text-muted-foreground">
                          <Lock className="h-3 w-3" /> Read-only
                        </span>
                      )}
                    </ArtifactDescription>
                  </div>
                  <ArtifactActions>
                    {!artifactReadOnly && (
                      <ArtifactAction
                        tooltip={artifactDirty ? "Save changes" : "Saved"}
                        disabled={!artifactDirty || artifactLoading}
                        onClick={handleSave}
                      >
                        {artifactLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </ArtifactAction>
                    )}
                    <ArtifactClose onClick={() => setSelectedResource(null)} />
                  </ArtifactActions>
                </ArtifactHeader>
                <ArtifactContent className="bg-muted/30">
                  {artifactLoading ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading
                    </div>
                  ) : artifactError ? (
                    <div className="text-sm text-red-500 whitespace-pre-wrap break-words">
                      {artifactError}
                    </div>
                  ) : (
                    <div className="flex h-full flex-col gap-2">
                      {artifactReadOnly ? (
                        artifactFileType === "markdown" ? (
                          <MarkdownViewer content={artifactText} />
                        ) : (
                          <pre className="h-full min-h-[240px] max-h-[70vh] w-full overflow-auto whitespace-pre-wrap rounded-md border bg-background p-4 font-mono text-sm leading-relaxed text-foreground">
                            {artifactText}
                          </pre>
                        )
                      ) : artifactFileType === "markdown" ? (
                        <TiptapMarkdownEditor
                          content={artifactText}
                          onChange={(newContent) => setArtifactText(newContent)}
                          readOnly={false}
                          placeholder="Start writing your markdown..."
                        />
                      ) : (
                        <JsonEditor
                          content={artifactText}
                          onChange={(newContent) => setArtifactText(newContent)}
                          readOnly={false}
                        />
                      )}
                      {artifactReadOnly && (
                        <p className="text-xs text-muted-foreground">
                          Runs are read-only; use the API to replay or inspect in detail.
                        </p>
                      )}
                    </div>
                  )}
                </ArtifactContent>
              </Artifact>
            </div>
          )}
        </div>
      </SidebarInset>
    </>
  );
}

export default function HomePage() {
  return (
    <SidebarProvider>
      <PageBody />
    </SidebarProvider>
  );
}
