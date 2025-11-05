import { ensureBaseDirs } from "./application/assistant/services/storage.js";
import { startCopilot } from "./application/assistant/chat.js";

ensureBaseDirs();

startCopilot().catch((err) => {
  console.error("Failed to run copilot:", err);
  process.exitCode = 1;
});
