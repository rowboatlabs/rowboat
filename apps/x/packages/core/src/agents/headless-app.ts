import container from "../di/container.js";
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

export { toolInputPaths } from "./headless.js";
