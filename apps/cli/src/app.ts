import { executeWorkflow, resumeWorkflow } from "./application/lib/exec-workflow.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type ParsedArgs = {
    command: "run" | "resume" | "help" | null;
    id: string | null;
    interactive: boolean;
    message: string;
};

function parseArgs(argv: string[]): ParsedArgs {
    const args = argv.slice(2);
    if (args.length === 0) {
        return { command: "help", id: null, interactive: true, message: "" };
    }

    let command: ParsedArgs["command"] = null;
    let id: string | null = null;
    let interactive = true;
    const messageParts: string[] = [];

    if (args[0] !== "run" && args[0] !== "resume") {
        command = "help";
        return { command, id: null, interactive, message: "" };
    }
    command = args[0];

    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith("--")) {
            if (a === "--no-interactive") {
                interactive = false;
            } else if (a.startsWith("--interactive")) {
                const [, value] = a.split("=");
                if (value === undefined) {
                    interactive = true;
                } else {
                    interactive = value !== "false";
                }
            }
            continue;
        }
        if (!id) {
            id = a;
            continue;
        }
        messageParts.push(a);
    }

    return { command, id, interactive, message: messageParts.join(" ") };
}

function printUsage(): void {
    console.log([
        "Usage:",
        "  rowboatx run <workflow_id> [message...] [--interactive | --no-interactive]",
        "  rowboatx resume <run_id> [message...] [--interactive | --no-interactive]",
        "",
        "Flags:",
        "  --interactive        Run interactively (default: true)",
        "  --no-interactive     Disable interactive prompts",
    ].join("\n"));
}

async function promptForResumeInput(): Promise<string> {
    const rl = createInterface({ input, output });
    try {
        const answer = await rl.question("Enter input to resume the run: ");
        return answer;
    } finally {
        rl.close();
    }
}

async function render(generator: AsyncGenerator<any, void, unknown>): Promise<void> {
    const renderer = new StreamRenderer();
    for await (const event of generator) {
        renderer.render(event);
        if (event?.type === "error") {
            process.exitCode = 1;
        }
    }
}

async function main() {
    const { command, id, interactive, message } = parseArgs(process.argv);

    if (command === "help" || !command) {
        printUsage();
        return;
    }
    if (!id) {
        printUsage();
        process.exitCode = 1;
        return;
    }

    switch (command) {
        case "run": {
            const initialInput = message ?? "";
            await render(executeWorkflow(id, initialInput, interactive));
            break;
        }
        case "resume": {
            const resumeInput = message !== "" ? message : (interactive ? await promptForResumeInput() : "");
            await render(resumeWorkflow(id, resumeInput, interactive));
            break;
        }
    }
}

main().catch((err) => {
    console.error("Failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});