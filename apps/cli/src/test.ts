import { RunEvent } from "./application/entities/workflow-event.js";

const obj = {"type":"tool-invocation","stepId":"test_agent","toolName":"ask-human","input":{"question":"Do you want me to run the command `date` in the terminal to show today’s date?"},"ts":"2025-11-11T06:31:20.103Z"};

console.log(RunEvent.parse(obj));