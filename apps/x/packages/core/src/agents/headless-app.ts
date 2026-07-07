import container from "../di/container.js";
import { chatActivity } from "../application/lib/chat-activity.js";
import { shouldDeferBackgroundTasks } from "../models/defaults.js";
import {
    type HeadlessAgentHandle,
    type HeadlessAgentOptions,
    type HeadlessAgentResult,
    type IHeadlessAgentRunner,
} from "./headless.js";

function runner(): IHeadlessAgentRunner {
    return container.resolve<IHeadlessAgentRunner>("headlessAgentRunner");
}

export function startHeadlessAgent(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentHandle> {
    return runner().start(options);
}

export function runHeadlessAgent(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentResult & { turnId: string }> {
    return runner().run(options);
}

// When the user enabled "Defer background tasks while a chat is running"
// (recommended for local models — a background run competes with the chat
// for the same hardware), wait for the chat to go idle before starting.
// Re-check after each wake: another chat turn may have started meanwhile.
async function waitForChatIdleIfConfigured(): Promise<void> {
    while ((await shouldDeferBackgroundTasks()) && chatActivity.activeCount > 0) {
        await chatActivity.waitUntilIdle();
    }
}

/** startHeadlessAgent for background work: honors the defer-while-chatting setting. */
export async function startWhenPossible(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentHandle> {
    await waitForChatIdleIfConfigured();
    return startHeadlessAgent(options);
}

/** runHeadlessAgent for background work: honors the defer-while-chatting setting. */
export async function runWhenPossible(
    options: HeadlessAgentOptions,
): Promise<HeadlessAgentResult & { turnId: string }> {
    await waitForChatIdleIfConfigured();
    return runHeadlessAgent(options);
}

export { toolInputPaths } from "./headless.js";
