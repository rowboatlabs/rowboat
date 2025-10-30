import readline from "readline";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { Workflow } from "../../application/entities/workflow.js";
import { listWorkflows, getWorkflow, upsertWorkflow, deleteWorkflow } from "./workflows/service.js";

const ChatCommand = z.object({
  action: z.enum([
    "help",
    "list_workflows",
    "get_workflow",
    "create_workflow",
    "update_workflow",
    "delete_workflow",
    "unknown",
  ]),
  id: z.string().optional(),
  updates: Workflow.partial().optional(),
});

type ChatCommandT = z.infer<typeof ChatCommand>;

const systemPrompt = `
You are a CLI assistant that converts the user's natural language into a JSON command for managing workflows.

Rules:
- Only output JSON matching the provided schema. No extra commentary.
- Choose the most appropriate action from: help, list_workflows, get_workflow, create_workflow, update_workflow, delete_workflow, unknown.
- For actions that need an id (get/update/delete/create), set "id" to the workflow identifier (e.g. "example_workflow").
- For create/update, include only provided fields in "updates". If not provided, omit.
- Workflow shape reminder: { name: string, description: string, steps: Step[] } where Step is either { type: "function", id: string } or { type: "agent", id: string }.
- If the request is ambiguous, set action to "unknown".
`;

async function interpret(input: string): Promise<ChatCommandT> {
  const { object } = await generateObject({
    model: openai("gpt-4.1"),
    system: systemPrompt,
    prompt: input,
    schema: ChatCommand,
  });
  return object;
}

async function execute(cmd: ChatCommandT): Promise<unknown> {
  switch (cmd.action) {
    case "help":
      return {
        usage: [
          "Examples:",
          "- list workflows",
          "- show workflow example_workflow",
          "- create workflow demo with one step calling function get_date",
          "- update workflow demo: add agent step default_assistant",
          "- delete workflow demo",
        ],
      };
    case "list_workflows":
      return { items: listWorkflows() };
    case "get_workflow":
      if (!cmd.id) return { error: "id required" };
      return getWorkflow(cmd.id) ?? null;
    case "create_workflow":
      if (!cmd.id) return { error: "id required" };
      return upsertWorkflow(cmd.id, { ...(cmd.updates ?? {}) });
    case "update_workflow":
      if (!cmd.id) return { error: "id required" };
      return upsertWorkflow(cmd.id, { ...(cmd.updates ?? {}) });
    case "delete_workflow":
      if (!cmd.id) return { error: "id required" };
      return { deleted: deleteWorkflow(cmd.id) };
    case "unknown":
      return { error: "Could not determine intent. Try again or ask for help." };
  }
}

export async function startCopilot(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Please export it to use chat.");
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("Rowboat Copilot (type 'exit' to quit)");

  const ask = () => rl.question("> ", async (line) => {
    if (!line || line.trim().toLowerCase() === "exit") {
      rl.close();
      return;
    }
    try {
      const cmd = await interpret(line);
      console.log("\n=== Parsed Command ===\n" + JSON.stringify(cmd, null, 2));
      const result = await execute(cmd);
      console.log("\n=== Result ===\n" + JSON.stringify(result, null, 2) + "\n");
    } catch (err) {
      console.error("Error:", (err as Error).message);
    }
    ask();
  });

  ask();
}
