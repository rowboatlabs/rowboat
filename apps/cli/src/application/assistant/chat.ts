import readline from "readline";
import { openai } from "@ai-sdk/openai";
import { generateObject, streamText } from "ai";
import type { CoreMessage } from "ai";
import {
  ChatCommand,
  ChatCommandT,
  CommandOutcome,
  executeCommand,
} from "./commands.js";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const systemPrompt = `
You are a general-purpose CLI copilot that converts the user's natural language into structured commands the Rowboat assistant runtime can execute, and you can also hold a regular conversation when no command fits.

Rules:
- Only output JSON matching the provided schema. No extra commentary.
- Select the most appropriate action from: help, general_chat, list_workflows, get_workflow, describe_workflows, create_workflow, update_workflow, delete_workflow, list_agents, get_agent, create_agent, update_agent, delete_agent, list_mcp_servers, add_mcp_server, remove_mcp_server, run_workflow, unknown.
- Use describe_workflows with { scope: "all" } to show every workflow, or provide specific ids when the user names particular workflows (including pronouns like "them" or "those" referring to previously listed workflows).
- For actions that need an id (workflow/agent), set "id" to the identifier (e.g. "example_workflow").
- For create/update actions, only include provided fields in "updates".
- Workflow shape reminder: { name: string, description: string, steps: Step[] } where Step is either { type: "function", id: string } or { type: "agent", id: string }.
- Agent shape reminder: { name: string, model: string, description: string, instructions: string }.
- MCP server shape reminder: { name: string, url: string }.
- If the request is ambiguous, set action to "unknown".
- If the user is just chatting or asking for general help or explanations, use action "general_chat" with their full prompt in "query".
`;

const responseSystemPrompt = `
You are Skipper, the Rowboat CLI copilot. You maintain an ongoing conversation, remember prior questions, run commands when requested, and give helpful free-form answers when a general reply is appropriate.

Guidelines:
- Respond in natural language with short, helpful paragraphs or bullet lists when useful.
- Summarise command results plainly (lists, confirmations, errors) and mention next steps when appropriate.
- If a command could not be inferred (action "unknown"), clarify what additional detail is needed or answer the query directly using the conversation history when possible.
- Use the conversation history to answer memory questions (for example "what was the first question I asked?").
- Avoid repeating the raw JSON command or result unless explicitly asked; focus on what the outcome means.
- Deliver everything requested in one response. Do not say you'll follow up later—include all available details right away.
- For general_chat actions, respond directly to the user's query with the best answer you can provide.
`;

function buildMessageHistory(history: ConversationMessage[]): CoreMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

async function interpret(input: string, history: ConversationMessage[]): Promise<ChatCommandT> {
  const stopSpinner = startSpinner("Analyzing…", { persist: false });
  const conversation: CoreMessage[] = [
    { role: "system", content: systemPrompt },
    ...buildMessageHistory(history),
    { role: "user", content: input },
  ];

  try {
    const { object } = await generateObject({
      model: openai("gpt-4.1"),
      messages: conversation,
      schema: ChatCommand,
    });
    return object;
  } finally {
    stopSpinner();
  }
}

function startSpinner(
  label: string,
  options: { persist?: boolean } = {}
): (finalMessage?: string) => void {
  const { persist = true } = options;
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴"];
  let index = 0;
  const render = () => {
    const frame = frames[index];
    index = (index + 1) % frames.length;
    process.stdout.write(`\r${frame} ${label}`);
  };
  render();
  const timer = setInterval(render, 80);
  return (finalMessage?: string) => {
    clearInterval(timer);
    const doneFrame = frames[(index + frames.length - 1) % frames.length];
    const message = finalMessage ?? "done";
    const clearWidth = doneFrame.length + label.length + (persist ? message.length + 3 : 2);
    const clear = " ".repeat(clearWidth);
    process.stdout.write(`\r${clear}`);
    if (persist) {
      process.stdout.write(`\r${doneFrame} ${label} ${message}\n`);
    } else {
      process.stdout.write("\r");
    }
  };
}

async function renderAssistantResponse(
  input: string,
  cmd: ChatCommandT,
  outcome: CommandOutcome,
  history: ConversationMessage[]
): Promise<string> {
  const condensedCommand = JSON.stringify(cmd, null, 2);
  const condensedResult = JSON.stringify(outcome, null, 2);

  const { textStream } = await streamText({
    model: openai("gpt-4.1"),
    messages: [
      { role: "system", content: responseSystemPrompt },
      ...buildMessageHistory(history),
      {
        role: "user",
        content: [
          `Most recent request: ${input}`,
          `Interpreter output:\n${condensedCommand}`,
          `Command result:\n${condensedResult}`,
        ].join("\n\n"),
      },
    ],
  });

  let final = "";
  for await (const textChunk of textStream as AsyncIterable<unknown>) {
    const chunk =
      typeof textChunk === "string"
        ? textChunk
        : typeof (textChunk as { value?: string }).value === "string"
          ? (textChunk as { value?: string }).value ?? ""
          : "";
    if (!chunk) continue;
    process.stdout.write(chunk);
    final += chunk;
  }

  if (!final.endsWith("\n")) {
    process.stdout.write("\n");
  }

  return final.trim();
}

export async function startCopilot(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set. Please export it to use chat.");
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("XRowboat Copilot (type 'exit' to quit)");

  const debugMode = process.argv.includes("--debug") || process.env.COPILOT_DEBUG === "1";
  const conversationHistory: ConversationMessage[] = [];

  const ask = () => rl.question("> ", async (line) => {
    if (!line || line.trim().toLowerCase() === "exit") {
      rl.close();
      return;
    }
    try {
      const trimmed = line.trim();
      const cmd = await interpret(trimmed, conversationHistory);
      let outcome: CommandOutcome;
      try {
        outcome = await executeCommand(cmd);
      } finally {
        // no-op
      }

      const historyWithLatestUser: ConversationMessage[] = [
        ...conversationHistory,
        { role: "user", content: trimmed },
      ];
      const assistantReply = await renderAssistantResponse(trimmed, cmd, outcome, historyWithLatestUser);
      console.log("");

      if (debugMode) {
        console.log("=== Parsed Command ===\n" + JSON.stringify(cmd, null, 2));
        console.log("\n=== Outcome ===\n" + JSON.stringify(outcome, null, 2) + "\n");
      }

      conversationHistory.push({ role: "user", content: trimmed });
      conversationHistory.push({ role: "assistant", content: assistantReply });
    } catch (err) {
      console.error("Error:", (err as Error).message);
    }
    ask();
  });

  ask();
}
