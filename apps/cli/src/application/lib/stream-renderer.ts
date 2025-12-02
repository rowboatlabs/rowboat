import { z } from "zod";
import { RunEvent } from "../../entities/run-events.js";
import { LlmStepStreamEvent } from "../../entities/llm-step-events.js";

export interface StreamRendererOptions {
    showHeaders?: boolean;
    dimReasoning?: boolean;
    jsonIndent?: number;
    truncateJsonAt?: number;
}

export class StreamRenderer {
    private options: Required<StreamRendererOptions>;
    private reasoningActive = false;
    private textActive = false;
    private firstText = true;

    constructor(options?: StreamRendererOptions) {
        this.options = {
            showHeaders: true,
            dimReasoning: true,
            jsonIndent: 2,
            truncateJsonAt: 500,
            ...options,
        };
    }

    render(event: z.infer<typeof RunEvent>) {
        switch (event.type) {
            case "start": {
                this.onStart(event.agentName, event.runId);
                break;
            }
            case "llm-stream-event": {
                this.renderLlmEvent(event.event);
                break;
            }
            case "message": {
                // this.onStepMessage(event.stepId, event.message);
                break;
            }
            case "tool-invocation": {
                this.onStepToolInvocation(event.toolName, event.input);
                break;
            }
            case "tool-result": {
                this.onStepToolResult(event.toolName, event.result);
                break;
            }
            case "error": {
                this.onError(event.error);
                break;
            }
        }
    }

    private renderLlmEvent(event: z.infer<typeof LlmStepStreamEvent>) {
        switch (event.type) {
            case "reasoning-start":
                this.onReasoningStart();
                break;
            case "reasoning-delta":
                this.onReasoningDelta(event.delta);
                break;
            case "reasoning-end":
                this.onReasoningEnd();
                break;
            case "text-start":
                this.onTextStart();
                break;
            case "text-delta":
                this.onTextDelta(event.delta);
                break;
            case "text-end":
                this.onTextEnd();
                break;
            case "tool-call":
                this.onToolCall(event.toolCallId, event.toolName, event.input);
                break;
            case "finish-step":
                this.onFinishStep(event.finishReason, event.usage);
                break;
        }
    }

    private onStart(agentName: string, runId: string) {
        this.write("\n");
        this.write(this.bold(`▶ Agent ${agentName} (run ${runId})`));
        this.write("\n");
        this.write(this.dim(`╰─────────────────────────────────────────────────\n`));
    }

    private onEnd() {
        this.write("\n");
        this.write(this.dim("─".repeat(50)));
        this.write("\n");
        this.write(this.green(this.bold("✓ Complete")));
        this.write("\n\n");
    }

    private onError(error: string) {
        this.write("\n");
        this.write(this.red(this.bold("✖ Error")));
        this.write("\n");
        this.write(this.red(this.indent(error)));
        this.write("\n\n");
    }

    private onStepStart() {
        this.write("\n");
        this.write(this.dim("│ "));
        this.write(this.dim("Step in progress..."));
        this.write("\n");
    }

    private onStepEnd() {
        // More subtle step end - just add a little spacing
        this.write(this.dim("\n"));
    }

    private onStepMessage(stepIndex: number, message: any) {
        const role = message?.role ?? "message";
        const content = message?.content;
        this.write(this.bold(`${role}: `));
        if (typeof content === "string") {
            this.write(content + "\n");
        } else {
            const pretty = this.truncate(JSON.stringify(message, null, this.options.jsonIndent));
            this.write(this.dim("\n" + this.indent(pretty) + "\n"));
        }
    }

    private onStepToolInvocation(toolName: string, input: string) {
        this.write("\n");
        this.write(this.cyan("┌─ ") + this.bold(this.cyan(`🔧 ${toolName}`)));
        this.write("\n");
        if (input && input.length) {
            this.write(this.dim("│ ") + this.dim(this.indent(this.truncate(input)).replace(/\n/g, "\n│ ")));
            this.write("\n");
        }
    }

    private onStepToolResult(toolName: string, result: unknown) {
        const res = this.truncate(JSON.stringify(result, null, this.options.jsonIndent));
        this.write(this.dim("│\n"));
        this.write(this.green("└─ ") + this.dim(this.green(`Result`)));
        this.write("\n");
        this.write(this.dim("  " + this.indent(res).replace(/\n/g, "\n  ")));
        this.write("\n");
    }

    private onReasoningStart() {
        if (this.reasoningActive) return;
        this.reasoningActive = true;
        if (this.options.showHeaders) {
            this.write("\n");
            this.write(this.dim("│ "));
            this.write(this.dim(this.italic("thinking... ")));
        }
    }

    private onReasoningDelta(delta: string) {
        if (!this.reasoningActive) this.onReasoningStart();
        this.write(this.options.dimReasoning ? this.dim(delta) : delta);
    }

    private onReasoningEnd() {
        if (!this.reasoningActive) return;
        this.reasoningActive = false;
        this.write("\n");
    }

    private onTextStart() {
        if (this.textActive) return;
        this.textActive = true;
        if (this.options.showHeaders && this.firstText) {
            this.write("\n");
            this.write(this.bold("╭─ ") + this.bold("Response"));
            this.write("\n");
            this.write(this.dim("│\n"));
            this.firstText = false;
        } else if (this.options.showHeaders) {
            this.write("\n");
            this.write(this.dim("│ "));
        }
    }

    private onTextDelta(delta: string) {
        // Add subtle left margin to assistant text for better readability
        const formattedDelta = this.neutral(delta);
        if (delta.includes("\n")) {
            this.write(formattedDelta.replace(/\n/g, "\n  "));
        } else {
            this.write(formattedDelta);
        }
    }

    private onTextEnd() {
        if (!this.textActive) return;
        this.textActive = false;
        this.write("\n");
    }

    private onToolCall(toolCallId: string, toolName: string, input: unknown) {
        const inputStr = this.truncate(JSON.stringify(input, null, this.options.jsonIndent));
        this.write("\n");
        this.write(this.magenta("┌─ ") + this.bold(this.magenta(`⚡ ${toolName}`)));
        this.write(this.dim(` (${toolCallId.slice(0, 8)}...)`));
        this.write("\n");
        this.write(this.dim("│ ") + this.dim(this.indent(inputStr).replace(/\n/g, "\n│ ")));
        this.write("\n");
        this.write(this.dim("└─────────────\n"));
    }

    private onPauseForHumanInput(toolCallId: string, question: string) {
        this.write(this.cyan(`\n→ Pause for human input (${toolCallId})`));
        this.write("\n");
        this.write(this.bold("Question: ") + question);
        this.write("\n");
    }

    private onFinishStep(
        finishReason: "stop" | "tool-calls" | "length" | "content-filter" | "error" | "other" | "unknown",
        usage: {
            inputTokens?: number;
            outputTokens?: number;
            totalTokens?: number;
            reasoningTokens?: number;
            cachedInputTokens?: number;
        }) {
        const parts: string[] = [];
        if (usage.inputTokens !== undefined) parts.push(`${this.dim("in:")} ${usage.inputTokens}`);
        if (usage.outputTokens !== undefined) parts.push(`${this.dim("out:")} ${usage.outputTokens}`);
        if (usage.reasoningTokens !== undefined) parts.push(`${this.dim("reasoning:")} ${usage.reasoningTokens}`);
        if (usage.cachedInputTokens !== undefined) parts.push(`${this.dim("cached:")} ${usage.cachedInputTokens}`);
        if (usage.totalTokens !== undefined) parts.push(`${this.dim("total:")} ${this.bold(usage.totalTokens.toString())}`);
        const line = parts.join(this.dim(" | "));
        this.write("\n");
        this.write(this.bold("╭─ ") + this.bold("Finish"));
        this.write("\n");
        this.write(this.dim("│ ") + this.dim("reason: ") + finishReason);
        if (line.length) {
            this.write("\n");
            this.write(this.dim("│ ") + line);
        }
        this.write("\n");
        this.write(this.dim("╰─────────────\n"));
    }

    // Formatting helpers
    private write(text: string) {
        process.stdout.write(text);
    }

    private indent(text: string): string {
        return text
            .split("\n")
            .map((line) => (line.length ? `  ${line}` : line))
            .join("\n");
    }

    private truncate(text: string): string {
        if (text.length <= this.options.truncateJsonAt) return text;
        return text.slice(0, this.options.truncateJsonAt) + "…";
    }

    private bold(text: string): string {
        return "\x1b[1m" + text + "\x1b[0m";
    }

    private dim(text: string): string {
        return "\x1b[2m" + text + "\x1b[0m";
    }

    private italic(text: string): string {
        return "\x1b[3m" + text + "\x1b[0m";
    }

    private cyan(text: string): string {
        return "\x1b[36m" + text + "\x1b[0m";
    }

    private green(text: string): string {
        return "\x1b[32m" + text + "\x1b[0m";
    }

    private red(text: string): string {
        return "\x1b[31m" + text + "\x1b[0m";
    }

    private magenta(text: string): string {
        return "\x1b[35m" + text + "\x1b[0m";
    }

    private yellow(text: string): string {
        return "\x1b[33m" + text + "\x1b[0m";
    }

    private neutral(text: string): string {
        return "\x1b[38;5;250m" + text + "\x1b[0m";
    }
}


