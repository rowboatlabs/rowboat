import { z } from "zod";
import { StreamEvent } from "../entities/stream-event.js";

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

    constructor(options?: StreamRendererOptions) {
        this.options = {
            showHeaders: true,
            dimReasoning: true,
            jsonIndent: 2,
            truncateJsonAt: 500,
            ...options,
        };
    }

    render(event: z.infer<typeof StreamEvent>) {
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
            case "usage":
                this.onUsage(event.usage);
                break;
        }
    }

    private onReasoningStart() {
        if (this.reasoningActive) return;
        this.reasoningActive = true;
        if (this.options.showHeaders) {
            this.write("\n");
            this.write(this.dim("Reasoning: "));
        }
    }

    private onReasoningDelta(delta: string) {
        if (!this.reasoningActive) this.onReasoningStart();
        this.write(this.options.dimReasoning ? this.dim(delta) : delta);
    }

    private onReasoningEnd() {
        if (!this.reasoningActive) return;
        this.reasoningActive = false;
        this.write(this.dim("\n"));
    }

    private onTextStart() {
        if (this.textActive) return;
        this.textActive = true;
        if (this.options.showHeaders) {
            this.write("\n");
            this.write(this.bold("Assistant: "));
        }
    }

    private onTextDelta(delta: string) {
        if (!this.textActive) this.onTextStart();
        this.write(delta);
    }

    private onTextEnd() {
        if (!this.textActive) return;
        this.textActive = false;
        this.write("\n");
    }

    private onToolCall(toolCallId: string, toolName: string, input: unknown) {
        const inputStr = this.truncate(JSON.stringify(input, null, this.options.jsonIndent));
        this.write("\n");
        this.write(this.cyan(`→ Tool call ${toolName} (${toolCallId})`));
        this.write("\n");
        this.write(this.dim(this.indent(inputStr)));
        this.write("\n");
    }

    private onUsage(usage: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        reasoningTokens?: number;
        cachedInputTokens?: number;
    }) {
        const parts: string[] = [];
        if (usage.inputTokens !== undefined) parts.push(`input=${usage.inputTokens}`);
        if (usage.outputTokens !== undefined) parts.push(`output=${usage.outputTokens}`);
        if (usage.reasoningTokens !== undefined) parts.push(`reasoning=${usage.reasoningTokens}`);
        if (usage.cachedInputTokens !== undefined) parts.push(`cached=${usage.cachedInputTokens}`);
        if (usage.totalTokens !== undefined) parts.push(`total=${usage.totalTokens}`);
        const line = parts.join(", ");
        this.write(this.dim(`\nUsage: ${line}\n`));
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

    private cyan(text: string): string {
        return "\x1b[36m" + text + "\x1b[0m";
    }
}


