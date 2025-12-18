import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Spinner from "ink-spinner";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import z from "zod";
import { RowboatApi } from "./api.js";
import { ModelConfig } from "../models/models.js";
import { Agent } from "../agents/agents.js";
import { ListRunsResponse } from "../runs/repo.js";
import { Run } from "../runs/runs.js";
import { RunEvent } from "../entities/run-events.js";

type AgentType = z.infer<typeof Agent>;
type ModelConfigType = z.infer<typeof ModelConfig>;
type RunSummary = z.infer<typeof ListRunsResponse>["runs"][number];
type RunType = z.infer<typeof Run>;
type RunEventType = z.infer<typeof RunEvent>;

type Toast = {
    type: "info" | "error" | "success";
    text: string;
};

type ChatLine = {
    text: string;
    color?: string;
    variant?: "user" | "assistant" | "streaming" | "thinking" | "system" | "tool" | "other";
};

type ModalState =
    | { type: "agent-picker" }
    | {
        type: "human-response";
        runId: string;
        requestId: string;
        subflow: string[];
        prompt: string;
        value: string;
        submitting: boolean;
    };

type ConnectionState = "connecting" | "ready" | "error";
type FocusTarget = "chat" | "sidebar";

type PendingPermission = {
    toolCallId: string;
    toolName: string;
    args: unknown;
    subflow: string[];
};

type PendingHuman = {
    toolCallId: string;
    query: string;
    subflow: string[];
};

type SidebarItem =
    | { kind: "action"; action: "new-copilot" | "new-agent"; label: string; hint?: string }
    | { kind: "run"; run: RunSummary; status: { label: string; color: string } };

export function RowboatTui({ serverUrl }: { serverUrl: string }) {
    const api = useMemo(() => new RowboatApi({ baseUrl: serverUrl }), [serverUrl]);
    const { exit } = useApp();
    const { stdout } = useStdout();

    const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [modelConfig, setModelConfig] = useState<ModelConfigType | null>(null);
    const [agents, setAgents] = useState<AgentType[]>([]);
    const [runs, setRuns] = useState<RunSummary[]>([]);
    const [runsCursor, setRunsCursor] = useState<string | undefined>();
    const [runsLoading, setRunsLoading] = useState<boolean>(false);
    const [runDetails, setRunDetails] = useState<Record<string, RunType>>({});
    const [activeRunId, setActiveRunId] = useState<string | null>(null);
    const [draftAgent, setDraftAgent] = useState<string>("copilot");
    const [composerValue, setComposerValue] = useState<string>("");
    const [composerBusy, setComposerBusy] = useState<boolean>(false);
    const [focusTarget, setFocusTarget] = useState<FocusTarget>("chat");
    const [sidebarIndex, setSidebarIndex] = useState<number>(0);
    const [toast, setToast] = useState<Toast | null>(null);
    const [modal, setModal] = useState<ModalState | null>(null);
    const [streamError, setStreamError] = useState<string | null>(null);
    const [eventStreamActive, setEventStreamActive] = useState<boolean>(false);
    const [chatScrollOffset, setChatScrollOffset] = useState<number>(0);

    const selectedRun = activeRunId ? runDetails[activeRunId] : undefined;
    const pendingPermissions = useMemo(() => derivePendingPermissions(selectedRun), [selectedRun]);
    const pendingHuman = useMemo(() => derivePendingHuman(selectedRun), [selectedRun]);

    const defaultCopilot = useMemo(() => {
        return "copilot";
    }, [agents]);

    useEffect(() => {
        if (!agents.length) {
            return;
        }
        setDraftAgent((prev) => prev || defaultCopilot);
    }, [agents, defaultCopilot]);

    const runStatusMap = useMemo(() => {
        const map: Record<string, { label: string; color: string }> = {};
        for (const summary of runs) {
            map[summary.id] = getRunStatus(runDetails[summary.id]);
        }
        return map;
    }, [runs, runDetails]);

    const sidebarItems: SidebarItem[] = useMemo(() => {
        const items: SidebarItem[] = [
            {
                kind: "action",
                action: "new-copilot",
                label: `+ New chat (${defaultCopilot})`,
                hint: "Ctrl+N",
            },
            {
                kind: "action",
                action: "new-agent",
                label: "+ New chat (choose agent)",
                hint: "Ctrl+G",
            },
        ];
        for (const run of runs) {
            items.push({
                kind: "run",
                run,
                status: runStatusMap[run.id] ?? { label: "loading…", color: "gray" },
            });
        }
        return items;
    }, [defaultCopilot, runStatusMap, runs]);

    useEffect(() => {
        setSidebarIndex((idx) => {
            if (sidebarItems.length === 0) {
                return 0;
            }
            return Math.min(idx, sidebarItems.length - 1);
        });
    }, [sidebarItems.length]);

    const showToast = useCallback((next: Toast) => {
        setToast(next);
    }, []);

    useEffect(() => {
        if (!toast) {
            return;
        }
        const timer = setTimeout(() => {
            setToast(null);
        }, 4000);
        return () => clearTimeout(timer);
    }, [toast]);

    const loadInitial = useCallback(async () => {
        setConnectionState("connecting");
        setConnectionError(null);
        try {
            const [health, config, agentList, runsResponse] = await Promise.all([
                api.getHealth(),
                api.getModelConfig(),
                api.listAgents(),
                api.listRuns(),
            ]);
            if (health.status !== "ok") {
                throw new Error("Server is not healthy");
            }
            setModelConfig(config);
            setAgents(agentList);
            setRuns(runsResponse.runs);
            setRunsCursor(runsResponse.nextCursor);
            setConnectionState("ready");
        } catch (error) {
            setConnectionState("error");
            setConnectionError(error instanceof Error ? error.message : String(error));
        }
    }, [api]);

    useEffect(() => {
        loadInitial();
    }, [loadInitial]);

    useEffect(() => {
        if (!activeRunId) {
            return;
        }
        if (runDetails[activeRunId]) {
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const run = await api.getRun(activeRunId);
                if (!cancelled) {
                    setRunDetails((prev) => ({
                        ...prev,
                        [run.id]: run,
                    }));
                }
            } catch (error) {
                if (!cancelled) {
                    showToast({
                        type: "error",
                        text: `Failed to load run: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [activeRunId, api, runDetails, showToast]);

    const refreshRuns = useCallback(async () => {
        setRunsLoading(true);
        try {
            const response = await api.listRuns();
            setRuns(response.runs);
            setRunsCursor(response.nextCursor);
        } catch (error) {
            showToast({
                type: "error",
                text: `Failed to refresh runs: ${error instanceof Error ? error.message : String(error)}`,
            });
        } finally {
            setRunsLoading(false);
        }
    }, [api, showToast]);

    useEffect(() => {
        if (connectionState !== "ready") {
            return;
        }
        let unsub: (() => void) | null = null;
        let cancelled = false;
        setStreamError(null);
        setEventStreamActive(false);
        (async () => {
            try {
                unsub = await api.subscribeToEvents((event) => {
                    if (cancelled) {
                        return;
                    }
                    setEventStreamActive(true);
                    if (event.type === "start") {
                        setRuns((prev) => {
                            const next = [...prev];
                            const idx = next.findIndex((r) => r.id === event.runId);
                            const summary: RunSummary = {
                                id: event.runId,
                                agentId: event.agentName,
                                createdAt: event.ts ?? new Date().toISOString(),
                            };
                            if (idx >= 0) {
                                next[idx] = summary;
                                return next;
                            }
                            return [summary, ...next];
                        });
                    }
                    setRunDetails((prev) => {
                        const existing = prev[event.runId];
                        if (!existing) {
                            return prev;
                        }
                        return {
                            ...prev,
                            [event.runId]: {
                                ...existing,
                                log: [...existing.log, event],
                            },
                        };
                    });
                }, (error) => {
                    setStreamError(error.message);
                });
            } catch (error) {
                if (!cancelled) {
                    setStreamError(error instanceof Error ? error.message : String(error));
                }
            }
        })();
        return () => {
            cancelled = true;
            unsub?.();
        };
    }, [api, connectionState]);

    const startDraftChat = useCallback((agentName: string) => {
        setActiveRunId(null);
        setDraftAgent(agentName);
        setComposerValue("");
        setFocusTarget("chat");
        setSidebarIndex(0);
    }, []);

    const composeMessage = useCallback(async (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) {
            return;
        }
        setComposerBusy(true);
        try {
            let runId = activeRunId;
            if (!runId) {
                const agentName = draftAgent || defaultCopilot;
                const run = await api.createRun(agentName);
                runId = run.id;
                setRuns((prev) => {
                    const without = prev.filter((r) => r.id !== run.id);
                    return [
                        {
                            id: run.id,
                            createdAt: run.createdAt,
                            agentId: run.agentId,
                        },
                        ...without,
                    ];
                });
                setRunDetails((prev) => ({
                    ...prev,
                    [run.id]: run,
                }));
                setActiveRunId(run.id);
            }
            await api.sendMessage(runId, trimmed);
            setComposerValue("");
            showToast({
                type: "success",
                text: "Message queued",
            });
        } catch (error) {
            showToast({
                type: "error",
                text: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
            });
        } finally {
            setComposerBusy(false);
        }
    }, [activeRunId, api, defaultCopilot, draftAgent, showToast]);

    const handleApprovePermission = useCallback(async () => {
        const run = selectedRun;
        const pending = pendingPermissions[0];
        if (!run || !pending) {
            showToast({ type: "info", text: "No pending tool permissions" });
            return;
        }
        try {
            await api.authorizeTool(run.id, {
                toolCallId: pending.toolCallId,
                response: "approve",
                subflow: pending.subflow,
            });
            showToast({ type: "success", text: `Approved ${pending.toolName}` });
        } catch (error) {
            showToast({
                type: "error",
                text: `Failed to approve: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }, [api, pendingPermissions, selectedRun, showToast]);

    const handleDenyPermission = useCallback(async () => {
        const run = selectedRun;
        const pending = pendingPermissions[0];
        if (!run || !pending) {
            showToast({ type: "info", text: "No pending tool permissions" });
            return;
        }
        try {
            await api.authorizeTool(run.id, {
                toolCallId: pending.toolCallId,
                response: "deny",
                subflow: pending.subflow,
            });
            showToast({ type: "success", text: `Denied ${pending.toolName}` });
        } catch (error) {
            showToast({
                type: "error",
                text: `Failed to deny: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }, [api, pendingPermissions, selectedRun, showToast]);

    const handleStopRun = useCallback(async () => {
        if (!selectedRun) {
            showToast({ type: "info", text: "No run selected" });
            return;
        }
        try {
            await api.stopRun(selectedRun.id);
            showToast({ type: "success", text: `Stop requested for ${selectedRun.id}` });
        } catch (error) {
            showToast({
                type: "error",
                text: `Failed to stop: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }, [api, selectedRun, showToast]);

    const handleReplyHuman = useCallback(async (value: string, context: PendingHuman | undefined) => {
        if (!selectedRun || !context) {
            showToast({ type: "info", text: "No pending human requests" });
            return;
        }
        try {
            await api.replyToHuman(selectedRun.id, context.toolCallId, {
                toolCallId: context.toolCallId,
                response: value,
                subflow: context.subflow,
            });
            showToast({ type: "success", text: "Reply sent" });
        } catch (error) {
            showToast({
                type: "error",
                text: `Failed to send reply: ${error instanceof Error ? error.message : String(error)}`,
            });
            throw error;
        }
    }, [api, selectedRun, showToast]);

    const currentHumanRequest = pendingHuman[0];
    const maxVisibleEvents = Math.max(8, (stdout?.rows ?? 40) - 14);

    const chatTimeline = useMemo(() => {
        if (!selectedRun) {
            return {
                visibleEvents: [] as ChatLine[],
                maxOffset: 0,
                total: 0,
            };
        }
        const lines: ChatLine[] = [];
        let streamingText = "";
        let streamingActive = false;
        let reasoningText = "";
        let reasoningActive = false;
        for (const event of selectedRun.log) {
            if (event.type === "llm-stream-event") {
                const step = event.event;
                switch (step.type) {
                    case "text-start":
                        streamingActive = true;
                        streamingText = "";
                        break;
                    case "text-delta":
                        streamingActive = true;
                        streamingText += step.delta;
                        break;
                    case "text-end":
                    case "finish-step":
                        streamingActive = false;
                        break;
                    case "reasoning-start":
                        reasoningActive = true;
                        reasoningText = "";
                        break;
                    case "reasoning-delta":
                        reasoningActive = true;
                        reasoningText += step.delta;
                        break;
                    case "reasoning-end":
                        reasoningActive = false;
                        break;
                    default:
                        break;
                }
                continue;
            }
            const formatted = formatEvent(event);
            if (formatted) {
                lines.push(formatted);
            }
        }
        if (reasoningActive && reasoningText) {
            lines.push({
                text: `assistant (thinking): ${reasoningText}`,
                color: "black",
                variant: "thinking",
            });
        }
        if (streamingActive && streamingText) {
            lines.push({
                text: `assistant (streaming): ${streamingText}`,
                color: "black",
                variant: "streaming",
            });
        }
        const total = lines.length;
        const maxOffset = Math.max(0, total - maxVisibleEvents);
        const clampedOffset = Math.min(chatScrollOffset, maxOffset);
        const end = total - clampedOffset;
        const start = Math.max(0, end - maxVisibleEvents);
        return {
            visibleEvents: lines.slice(start, end),
            maxOffset,
            total,
        };
    }, [chatScrollOffset, maxVisibleEvents, selectedRun]);

    useEffect(() => {
        setChatScrollOffset(0);
    }, [selectedRun?.id]);

    useEffect(() => {
        setChatScrollOffset((offset) => Math.min(offset, chatTimeline.maxOffset));
    }, [chatTimeline.maxOffset]);

    useInput((input, key) => {
        if (modal) {
            if (key.escape) {
                setModal(null);
            }
            return;
        }
        if (key.tab) {
            setFocusTarget((prev) => (prev === "chat" ? "sidebar" : "chat"));
            return;
        }
        if (key.ctrl && input === "q") {
            exit();
            return;
        }
        if (key.ctrl && input === "n") {
            startDraftChat(defaultCopilot);
            return;
        }
        if (key.ctrl && input === "g") {
            if (agents.length === 0) {
                showToast({ type: "error", text: "No agents available" });
                return;
            }
            setModal({ type: "agent-picker" });
            return;
        }
        if (key.ctrl && input === "l") {
            refreshRuns();
            return;
        }
        if (key.ctrl && input === "a") {
            handleApprovePermission();
            return;
        }
        if (key.ctrl && input === "d") {
            handleDenyPermission();
            return;
        }
        if (key.ctrl && input === "s") {
            handleStopRun();
            return;
        }
        if (key.ctrl && input === "h") {
            if (!currentHumanRequest) {
                showToast({ type: "info", text: "No pending human input requests" });
                return;
            }
            if (!selectedRun) {
                showToast({ type: "info", text: "Select a run to respond" });
                return;
            }
            setModal({
                type: "human-response",
                runId: selectedRun.id,
                requestId: currentHumanRequest.toolCallId,
                subflow: currentHumanRequest.subflow,
                prompt: currentHumanRequest.query,
                value: "",
                submitting: false,
            });
            return;
        }
        if (focusTarget === "sidebar") {
            if (key.upArrow) {
                setSidebarIndex((idx) => Math.max(0, idx - 1));
                return;
            }
            if (key.downArrow) {
                setSidebarIndex((idx) => Math.min(sidebarItems.length - 1, idx + 1));
                return;
            }
            if (key.return) {
                const item = sidebarItems[sidebarIndex];
                if (!item) {
                    return;
                }
                if (item.kind === "action") {
                    if (item.action === "new-copilot") {
                        startDraftChat(defaultCopilot);
                    } else {
                        if (agents.length === 0) {
                            showToast({ type: "error", text: "No agents available" });
                        } else {
                            setModal({ type: "agent-picker" });
                        }
                    }
                } else {
                    setActiveRunId(item.run.id);
                    setFocusTarget("chat");
                }
            }
        }
        if (focusTarget === "chat") {
            const scrollStep = Math.max(3, Math.floor(maxVisibleEvents / 2));
            if (key.pageUp) {
                setChatScrollOffset((offset) => Math.min(chatTimeline.maxOffset, offset + scrollStep));
                return;
            }
            if (key.pageDown) {
                setChatScrollOffset((offset) => Math.max(0, offset - scrollStep));
                return;
            }
        }
    });

    return (
        <Box flexDirection="column" padding={1} height="100%" flexGrow={1} gap={1}>
            <Header
                serverUrl={serverUrl}
                state={connectionState}
                error={connectionError}
                modelConfig={modelConfig}
                agentsCount={agents.length}
                runsCount={runs.length}
                runsCursor={runsCursor}
                streamError={streamError}
                listening={eventStreamActive}
            />

            <Box flexDirection="row" gap={1} flexGrow={1} minHeight={0}>
                <Sidebar
                    items={sidebarItems}
                    focus={focusTarget === "sidebar"}
                    index={sidebarIndex}
                    activeRunId={activeRunId}
                    runsLoading={runsLoading}
                />
                <ChatPanel
                    focus={focusTarget === "chat"}
                    draftAgent={draftAgent || defaultCopilot}
                    run={selectedRun}
                    events={chatTimeline.visibleEvents}
                    composerValue={composerValue}
                    composerBusy={composerBusy}
                    onChangeComposer={setComposerValue}
                    onSubmitComposer={composeMessage}
                    pendingPermissions={pendingPermissions}
                    pendingHuman={pendingHuman}
                    showHumanHint={Boolean(currentHumanRequest)}
                    showPermissionHint={pendingPermissions.length > 0}
                    scrollHint={chatTimeline.maxOffset > 0}
                />
            </Box>

            <Box>
                <Text dimColor>
                    Tab toggles focus · Ctrl+N new Copilot chat · Ctrl+G choose agent · Ctrl+L refresh chats · Ctrl+Q quit
                </Text>
            </Box>

            {toast && (
                <Box>
                    <Text color={toast.type === "error" ? "red" : toast.type === "success" ? "green" : "yellow"}>
                        {toast.text}
                    </Text>
                </Box>
            )}

            {modal && (
                <ModalSurface>
                    {modal.type === "agent-picker" && (
                        <AgentPickerModal
                            agents={agents}
                            onSelect={(agent) => {
                                setModal(null);
                                startDraftChat(agent);
                            }}
                            onCancel={() => setModal(null)}
                        />
                    )}
                    {modal.type === "human-response" && (
                        <MessageModal
                            typeLabel="Reply to agent"
                            prompt={modal.prompt}
                            value={modal.value}
                            submitting={modal.submitting}
                            onChange={(value) => setModal({ ...modal, value })}
                            onSubmit={async (value) => {
                                const ctx: PendingHuman = {
                                    toolCallId: modal.requestId,
                                    query: modal.prompt,
                                    subflow: modal.subflow,
                                };
                                setModal({ ...modal, submitting: true });
                                try {
                                    await handleReplyHuman(value.trim(), ctx);
                                    setModal(null);
                                } catch {
                                    setModal({ ...modal, submitting: false });
                                }
                            }}
                            onCancel={() => setModal(null)}
                        />
                    )}
                </ModalSurface>
            )}
        </Box>
    );
}

function Header({
    serverUrl,
    state,
    error,
    modelConfig,
    agentsCount,
    runsCount,
    runsCursor,
    streamError,
    listening,
}: {
    serverUrl: string;
    state: ConnectionState;
    error: string | null;
    modelConfig: ModelConfigType | null;
    agentsCount: number;
    runsCount: number;
    runsCursor: string | undefined;
    streamError: string | null;
    listening: boolean;
}) {
    return (
        <Box flexDirection="column">
            <Text>
                <Text color="cyanBright">RowboatX</Text> chat · Server {serverUrl}
            </Text>
            <Text>
                {state === "connecting" && (
                    <>
                        <Text color="yellow">
                            <Spinner type="dots" />
                        </Text>{" "}
                        Connecting…
                    </>
                )}
                {state === "ready" && (
                    <Text color="green">
                        Connected · default {modelConfig?.defaults?.provider ?? "n/a"}/{modelConfig?.defaults?.model ?? "n/a"}
                    </Text>
                )}
                {state === "error" && (
                    <Text color="red">
                        Offline: {error ?? "Unknown error"} · Ctrl+L to retry
                    </Text>
                )}
            </Text>
            <Text dimColor>
                Agents: {agentsCount} · Chats loaded: {runsCount}
                {runsCursor ? " (+ more)" : ""}
            </Text>
            {streamError && (
                <Text color="yellow">Event stream issue: {streamError}</Text>
            )}
            {state === "ready" && listening === false && (
                <Text dimColor>Listening for run events…</Text>
            )}
        </Box>
    );
}

function Sidebar({
    items,
    focus,
    index,
    activeRunId,
    runsLoading,
}: {
    items: SidebarItem[];
    focus: boolean;
    index: number;
    activeRunId: string | null;
    runsLoading: boolean;
}) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={focus ? "cyan" : "gray"} padding={1} width={38} minHeight={0}>
            <Text color="cyan">Chats</Text>
            <Text dimColor>{focus ? "↑/↓ move · Enter select · Esc to leave" : "Tab to focus sidebar"}</Text>
            <Box marginTop={1} flexDirection="column" flexGrow={1} minHeight={0}>
                {runsLoading && (
                    <Text color="yellow">
                        <Spinner type="dots" /> refreshing…
                    </Text>
                )}
                {items.length === 0 && <Text dimColor>No chats yet.</Text>}
                {items.map((item, idx) => {
                    let divider: React.ReactNode = null;
                    const isCursor = focus && idx === index;
                    if (item.kind === "action") {
                        return (
                            <Text key={item.action} color={isCursor ? "greenBright" : "green"}>
                                {isCursor ? "❯" : " "} {item.label} {item.hint ? `(${item.hint})` : ""}
                            </Text>
                        );
                    }
                    const previousRuns = items.slice(0, idx).some((entry) => entry.kind === "run");
                    if (!previousRuns) {
                        divider = (
                            <Box key={`divider-${idx}`} marginY={1}>
                                <Text dimColor>── recent chats ──</Text>
                            </Box>
                        );
                    }
                    const isActiveRun = item.run.id === activeRunId;
                    return (
                        <Box key={item.run.id} flexDirection="column">
                            {divider}
                            <Text>
                                <Text color={isCursor ? "greenBright" : isActiveRun ? "cyan" : undefined}>
                                    {isCursor ? "❯" : isActiveRun ? "●" : " "}
                                </Text>{" "}
                                <Text bold={isActiveRun}>{item.run.agentId}</Text>{" "}
                                <Text dimColor>{item.run.id}</Text>{" "}
                                <Text color={item.status.color}>{item.status.label}</Text>{" "}
                                <Text dimColor>{timeAgo(item.run.createdAt)}</Text>
                            </Text>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
}

function ChatPanel({
    focus,
    draftAgent,
    run,
    events,
    composerValue,
    composerBusy,
    onChangeComposer,
    onSubmitComposer,
    pendingPermissions,
    pendingHuman,
    showHumanHint,
    showPermissionHint,
    scrollHint,
}: {
    focus: boolean;
    draftAgent: string;
    run: RunType | undefined;
    events: ChatLine[];
    composerValue: string;
    composerBusy: boolean;
    onChangeComposer: (value: string) => void;
    onSubmitComposer: (value: string) => void;
    pendingPermissions: PendingPermission[];
    pendingHuman: PendingHuman[];
    showHumanHint: boolean;
    showPermissionHint: boolean;
    scrollHint: boolean;
}) {
    return (
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={focus ? "cyan" : "gray"} padding={1} minHeight={0}>
            <Text>
                <Text color="cyan" bold>
                    {run ? run.agentId : draftAgent}
                </Text>{" "}
                {run ? (
                    <>
                        · Run {run.id} · started {formatTimestamp(run.createdAt)} ({timeAgo(run.createdAt)})
                    </>
                ) : (
                    <Text dimColor>· new chat</Text>
                )}
            </Text>
            {!run && (
                <Text dimColor>Type a prompt and press enter to spin up a new {draftAgent} chat.</Text>
            )}
            {showPermissionHint && (
                <Text color="yellow">Tool approval pending · Ctrl+A approve · Ctrl+D deny</Text>
            )}
            {showHumanHint && (
                <Text color="magenta">Agent asked for help · Ctrl+H to reply</Text>
            )}
            <Box flexDirection="column" flexGrow={1} marginTop={1} overflow="hidden">
                {run && events.length === 0 && (
                    <Text dimColor>Loading chat log…</Text>
                )}
                {!run && (
                    <Text dimColor>No messages yet.</Text>
                )}
                {events.map((event, idx) => (
                    <MessageBubble key={`${event.text}-${idx}-${event.variant}`} event={event} />
                ))}
            </Box>
            <Box flexDirection="column" marginTop={1}>
                <Text dimColor>
                    {focus
                        ? `Enter to send · Ctrl+N new chat${scrollHint ? " · PgUp/PgDn scroll" : ""}`
                        : "Tab to focus composer"}
                </Text>
                <TextInput
                    value={composerValue}
                    onChange={onChangeComposer}
                    onSubmit={(value) => onSubmitComposer(value)}
                    focus={focus && !composerBusy}
                    placeholder="Send a message…"
                />
                {composerBusy && (
                    <Text color="yellow">
                        <Spinner type="dots" /> Sending…
                    </Text>
                )}
            </Box>
        </Box>
    );
}

function ModalSurface({ children }: { children: React.ReactNode }) {
    return (
        <Box marginTop={1} justifyContent="center">
            <Box borderStyle="round" borderColor="cyan" padding={1} width="80%" flexDirection="column">
                {children}
            </Box>
        </Box>
    );
}

function AgentPickerModal({
    agents,
    onSelect,
    onCancel,
}: {
    agents: AgentType[];
    onSelect: (agentName: string) => void;
    onCancel: () => void;
}) {
    const items = agents.map((agent) => ({
        label: `${agent.name}${agent.description ? ` – ${truncate(agent.description, 40)}` : ""}`,
        value: agent.name,
    }));
    return (
        <Box flexDirection="column">
            <Text>Select an agent (esc to cancel)</Text>
            {items.length === 0 ? (
                <Text color="yellow">No agents configured.</Text>
            ) : (
                <SelectInput<string>
                    items={items}
                    onSelect={(item) => onSelect(item.value)}
                />
            )}
            <Text dimColor>{items.length} agents available.</Text>
        </Box>
    );
}

function MessageModal({
    typeLabel,
    prompt,
    value,
    submitting,
    onChange,
    onSubmit,
    onCancel,
}: {
    typeLabel: string;
    prompt?: string;
    value: string;
    submitting: boolean;
    onChange: (value: string) => void;
    onSubmit: (value: string) => Promise<void>;
    onCancel: () => void;
}) {
    return (
        <Box flexDirection="column">
            <Text>{typeLabel} (esc to cancel)</Text>
            {prompt && (
                <Text dimColor>{truncate(prompt, 120)}</Text>
            )}
            <TextInput
                value={value}
                onChange={onChange}
                onSubmit={(text) => {
                    if (!text.trim()) {
                        return;
                    }
                    onSubmit(text);
                }}
                focus={!submitting}
                placeholder="Type your response…"
            />
            {submitting ? (
                <Text color="yellow">
                    <Spinner type="dots" /> Sending…
                </Text>
            ) : (
                <Text dimColor>Enter to submit · esc to cancel</Text>
            )}
        </Box>
    );
}

function derivePendingPermissions(run: RunType | undefined): PendingPermission[] {
    if (!run) {
        return [];
    }
    const responded = new Set(
        run.log
            .filter((event) => event.type === "tool-permission-response")
            .map((event) => event.toolCallId),
    );
    const pending: PendingPermission[] = [];
    for (const event of run.log) {
        if (event.type === "tool-permission-request") {
            const id = event.toolCall.toolCallId;
            if (!responded.has(id)) {
                pending.push({
                    toolCallId: id,
                    toolName: event.toolCall.toolName,
                    args: event.toolCall.arguments,
                    subflow: event.subflow,
                });
            }
        }
    }
    return pending;
}

function derivePendingHuman(run: RunType | undefined): PendingHuman[] {
    if (!run) {
        return [];
    }
    const responded = new Set(
        run.log
            .filter((event) => event.type === "ask-human-response")
            .map((event) => event.toolCallId),
    );
    const pending: PendingHuman[] = [];
    for (const event of run.log) {
        if (event.type === "ask-human-request" && !responded.has(event.toolCallId)) {
            pending.push({
                toolCallId: event.toolCallId,
                query: event.query,
                subflow: event.subflow,
            });
        }
    }
    return pending;
}

function getRunStatus(run: RunType | undefined): { label: string; color: string } {
    if (!run) {
        return { label: "loading…", color: "gray" };
    }
    const last = run.log[run.log.length - 1];
    if (last?.type === "error") {
        return { label: "error", color: "red" };
    }
    if (derivePendingHuman(run).length > 0) {
        return { label: "awaiting human", color: "magenta" };
    }
    if (derivePendingPermissions(run).length > 0) {
        return { label: "needs approval", color: "yellow" };
    }
    return { label: "running", color: "green" };
}

function MessageBubble({ event }: { event: ChatLine }) {
    const isUser = event.variant === "user";
    const isAssistant = event.variant === "assistant" || event.variant === "streaming";
    const align = isUser ? "flex-end" : "flex-start";
    const bubbleColor = isUser ? "blue" : undefined;
    const textColor = isUser ? "white" : event.color;
    return (
        <Box justifyContent={align} marginBottom={1}>
            <Box width="80%">
                <Text
                    backgroundColor={bubbleColor}
                    color={textColor}
                >
                    {event.text}
                </Text>
            </Box>
        </Box>
    );
}

function formatEvent(event: RunEventType): ChatLine | null {
    switch (event.type) {
        case "start":
            return { text: `▶ Start · ${event.agentName}`, color: "green", variant: "system" };
        case "message": {
            const content = typeof event.message.content === "string"
                ? event.message.content
                : event.message.content
                    .map((part) => {
                        if (part.type === "text" || part.type === "reasoning") {
                            return part.text;
                        }
                        if (part.type === "tool-call") {
                            return `[tool:${part.toolName}] ${JSON.stringify(part.arguments)}`;
                        }
                        return "";
                    })
                    .join("\n");
            return {
                text: `${event.message.role}: ${content}`,
                color: event.message.role === "user" ? "black" : event.message.role === "assistant" ? "black" : "white",
                variant: event.message.role === "user"
                    ? "user"
                    : event.message.role === "assistant"
                        ? "assistant"
                        : "system",
            };
        }
        case "tool-invocation":
            return { text: `🔧 Invoking ${event.toolName} ${JSON.stringify(event.input)}`, color: "yellow", variant: "tool" };
        case "tool-result":
            return { text: `✅ ${event.toolName} → ${truncate(JSON.stringify(event.result), 120)}`, color: "green", variant: "tool" };
        case "tool-permission-request":
            return { text: `⚠️ Permission needed for ${event.toolCall.toolName}`, color: "yellow", variant: "system" };
        case "tool-permission-response":
            return { text: `Permission ${event.response} for ${event.toolCallId}`, color: event.response === "approve" ? "green" : "red", variant: "system" };
        case "ask-human-request":
            return { text: `🧑 Agent asks: ${truncate(event.query, 120)}`, color: "magenta", variant: "system" };
        case "ask-human-response":
            return { text: `🙋 Human replied`, color: "magenta", variant: "system" };
        case "llm-stream-event":
            return { text: `… ${event.event.type}`, color: "gray" };
        case "error":
            return { text: `✖ ${event.error}`, color: "red", variant: "system" };
        case "spawn-subflow":
            return { text: `↳ Spawned ${event.agentName}`, color: "cyan", variant: "system" };
        default:
            return { text: "unknown event", color: "white", variant: "other" };
    }
}

function truncate(input: string, len = 60): string {
    if (input.length <= len) {
        return input;
    }
    return `${input.slice(0, len - 1)}…`;
}

function formatTimestamp(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    return date.toLocaleString();
}

function timeAgo(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
