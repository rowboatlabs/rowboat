import { executeWorkflow } from "./application/lib/exec-workflow.js";
import { StreamRenderer } from "./application/lib/stream-renderer.js";


async function runWorkflow(id: string, userInput: string) {
    const renderer = new StreamRenderer();
    for await (const event of executeWorkflow(id, userInput)) {
        renderer.render(event);
    }
}

const workflowId = process.argv[2] ?? "example_workflow";
const userInputMsg = process.argv[3] ?? "";

runWorkflow(workflowId, userInputMsg);