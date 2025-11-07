import fs from "fs";
import path from "path";
import { WorkDir } from "../config/config.js";
import { Workflow } from "../entities/workflow.js";

export function loadWorkflow(id: string) {
    const workflowPath = path.join(WorkDir, "workflows", `${id}.json`);
    const workflow = fs.readFileSync(workflowPath, "utf8");
    return Workflow.parse(JSON.parse(workflow));
}
