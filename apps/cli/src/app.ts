import { streamAgent } from "./application/lib/agent.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";

export async function app(opts: {
    agent: string;
    runId?: string;
    input?: string;
}) {
    const renderer = new StreamRenderer();
    for await (const event of streamAgent({
        ...opts,
        interactive: true,
    })) {
        renderer.render(event);
        if (event?.type === "error") {
            process.exitCode = 1;
        }
    }
}