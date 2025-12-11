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
import { useState, useEffect, useRef } from "react";
import { GlobeIcon, MicIcon } from "lucide-react";
import { RunEvent } from "@/lib/cli-client";

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
  input: any;
  result?: any;
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

export default function HomePage() {
  const [text, setText] = useState<string>("");
  const [useWebSearch, setUseWebSearch] = useState<boolean>(false);
  const [useMicrophone, setUseMicrophone] = useState<boolean>(false);
  const [status, setStatus] = useState<
    "submitted" | "streaming" | "ready" | "error"
  >("ready");
  
  // Chat state
  const [runId, setRunId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>("");
  const [currentReasoning, setCurrentReasoning] = useState<string>("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const committedMessageIds = useRef<Set<string>>(new Set());
  const isEmptyConversation =
    conversation.length === 0 && !currentAssistantMessage && !currentReasoning;

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
          <PromptInputButton
            onClick={() => setUseWebSearch(!useWebSearch)}
            variant={useWebSearch ? "default" : "ghost"}
          >
            <GlobeIcon size={16} />
            <span>Search</span>
          </PromptInputButton>
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
    const eventSource = new EventSource('/api/stream');
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
  }, []); // Empty deps - only run once

  // Handle different event types from the copilot
  const handleEvent = (event: RunEvent) => {
    console.log('Event received:', event.type, event);

    switch (event.type) {
      case 'start':
        setStatus('streaming');
        setCurrentAssistantMessage('');
        setCurrentReasoning('');
        break;

      case 'llm-stream-event':
        console.log('LLM stream event type:', event.event?.type);
        
        if (event.event?.type === 'reasoning-delta') {
          setCurrentReasoning(prev => prev + event.event.delta);
        } else if (event.event?.type === 'reasoning-end') {
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
        } else if (event.event?.type === 'text-delta') {
          setCurrentAssistantMessage(prev => prev + event.event.delta);
          setStatus('streaming');
        } else if (event.event?.type === 'text-end') {
          console.log('TEXT END received - waiting for message event');
        } else if (event.event?.type === 'tool-call') {
          // Add tool call to conversation immediately
          setConversation(prev => [...prev, {
            id: event.event.toolCallId,
            type: 'tool',
            name: event.event.toolName,
            input: event.event.input,
            status: 'running',
            timestamp: Date.now(),
          }]);
        } else if (event.event?.type === 'finish-step') {
          console.log('FINISH STEP received - waiting for message event');
        }
        break;

      case 'message':
        console.log('MESSAGE event received:', event);
        if (event.message?.role === 'assistant') {
          // If the final assistant message contains tool calls, sync them to conversation
          if (Array.isArray(event.message.content)) {
            const toolCalls = event.message.content.filter(
              (part: any) => part?.type === 'tool-call'
            );
            if (toolCalls.length) {
              setConversation((prev) => {
                const updated = [...prev];
                for (const part of toolCalls) {
                  const idx = updated.findIndex(
                    (item) => item.type === 'tool' && item.id === part.toolCallId
                  );
                  if (idx >= 0) {
                    updated[idx] = {
                      ...updated[idx],
                      name: part.toolName,
                      input: part.arguments,
                      status: 'pending',
                    };
                  } else {
                    updated.push({
                      id: part.toolCallId,
                      type: 'tool',
                      name: part.toolName,
                      input: part.arguments,
                      status: 'pending',
                      timestamp: Date.now(),
                    });
                  }
                }
                return updated;
              });
            }
          }

          const messageId = event.messageId || `assistant-${Date.now()}`;
          
          if (committedMessageIds.current.has(messageId)) {
            console.log('⚠️ Message already committed, skipping:', messageId);
            return;
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
        }
        break;

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
        if (event.error && !event.error.includes('terminated')) {
          setStatus('error');
          console.error('Agent error:', event.error);
        } else {
          console.log('Connection error (will auto-reconnect):', event.error);
          setStatus('ready');
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
      // Send message to backend
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          runId: runId,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const data = await response.json();
      
      // Store runId for subsequent messages
      if (data.runId && !runId) {
        setRunId(data.runId);
      }

      setStatus('streaming');
    } catch (error) {
      console.error('Failed to send message:', error);
      setStatus('error');
      setTimeout(() => setStatus('ready'), 2000);
    }
  };

  return (
    <SidebarProvider>
      <AppSidebar />
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

        <div className="relative flex w-full flex-1 min-h-0 flex-col overflow-hidden">
          {/* Messages area */}
          <Conversation className="flex-1 min-h-0 pb-48">
            <ConversationContent className="!flex !flex-col !items-center !gap-8 !p-4">
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
                  const stateMap: Record<string, any> = {
                    'pending': 'input-streaming',
                    'running': 'input-available',
                    'completed': 'output-available',
                    'error': 'output-error',
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
                          {item.result && (
                            <ToolOutput output={item.result} errorText={undefined} />
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
            <div className="absolute bottom-2 left-0 right-0 flex justify-center w-full px-4 pb-5 pt-1 bg-background/95 backdrop-blur-sm">
              <div className="w-full max-w-3xl">
                {renderPromptInput()}
              </div>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
