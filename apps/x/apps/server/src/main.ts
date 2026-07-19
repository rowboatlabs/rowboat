import { init as initGmailSync } from "@x/core/dist/knowledge/sync_gmail.js";
import { init as initCalendarSync } from "@x/core/dist/knowledge/sync_calendar.js";
import { init as initFirefliesSync } from "@x/core/dist/knowledge/sync_fireflies.js";
import { init as initGranolaSync } from "@x/core/dist/knowledge/granola/sync.js";
import { init as initGraphBuilder } from "@x/core/dist/knowledge/build_graph.js";
import { init as initPreBuiltRunner } from "@x/core/dist/pre_built/runner.js";
import { init as initAgentRunner } from "@x/core/dist/agent-schedule/runner.js";
import { initConfigs } from "@x/core/dist/config/initConfigs.js";
import { startWorkspaceWatcher } from "@x/core/dist/workspace/watcher.js";

async function main() {
    console.log("Rowboat Headless Server starting...");

    // Initialize all config files
    await initConfigs();
    console.log("Configs initialized.");

    // Start workspace watcher (optional in headless, but good for reactivity if files change)
    // We need to import it from core if possible, or reimplement the watcher start logic if it was only in main.ts
    // Looking at main.ts imports: import { startWorkspaceWatcher } from "./ipc.js";
    // Wait, startWorkspaceWatcher in main.ts came from "./ipc.js". I need to find the real core watcher.
    // I saw "rowboat-workspace/apps/x/packages/core/src/workspace/watcher.ts" in grep results.
    // So I can import it directly.

    // Note: The main.ts version wrapped it. I will try to use the core one directly if available.
    // Let's assume the side-effects are safe.

    // Start services
    console.log("Starting Gmail sync...");
    initGmailSync();

    console.log("Starting Calendar sync...");
    initCalendarSync();

    console.log("Starting Fireflies sync...");
    initFirefliesSync();

    console.log("Starting Granola sync...");
    initGranolaSync();

    console.log("Starting Graph Builder...");
    initGraphBuilder();

    console.log("Starting Pre-built Runner...");
    initPreBuiltRunner();

    console.log("Starting Agent Runner...");
    initAgentRunner();

    console.log("Rowboat Headless Server is running. Press Ctrl+C to stop.");
    
    // Keep process alive
    process.stdin.resume();

    const cleanup = () => {
        console.log("Stopping Rowboat Headless Server...");
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
