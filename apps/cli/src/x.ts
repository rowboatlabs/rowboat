import { startCopilot } from "./application/assistant/chat.js";

export const start = () => {
  startCopilot().catch((err) => {
    console.error("Failed to run copilot:", err);
    process.exitCode = 1;
  });
}
