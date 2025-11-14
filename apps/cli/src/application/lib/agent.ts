import { Message, MessageList } from "../entities/message.js";
import { z } from "zod";
import { ModelMessage } from "ai";


export function convertFromMessages(messages: z.infer<typeof Message>[]): ModelMessage[] {
    const result: ModelMessage[] = [];
    for (const msg of messages) {
        switch (msg.role) {
            case "assistant":
                if (typeof msg.content === 'string') {
                    result.push({
                        role: "assistant",
                        content: msg.content,
                    });
                } else {
                    result.push({
                        role: "assistant",
                        content: msg.content.map(part => {
                            switch (part.type) {
                                case 'text':
                                    return part;
                                case 'reasoning':
                                    return part;
                                case 'tool-call':
                                    return {
                                        type: 'tool-call',
                                        toolCallId: part.toolCallId,
                                        toolName: part.toolName,
                                        input: part.arguments,
                                    };
                            }
                        }),
                    });
                }
                break;
            case "system":
                result.push({
                    role: "system",
                    content: msg.content,
                });
                break;
            case "user":
                result.push({
                    role: "user",
                    content: msg.content,
                });
                break;
            case "tool":
                result.push({
                    role: "tool",
                    content: [
                        {
                            type: "tool-result",
                            toolCallId: msg.toolCallId,
                            toolName: msg.toolName,
                            output: {
                                type: "text",
                                value: msg.content,
                            },
                        },
                    ],
                });
                break;
        }
    }
    return result;
}

// export class AgentNode implements Step {
//     private id: string;
//     private asTool: boolean;
//     private agent: z.infer<typeof Agent>;

//     constructor(id: string, asTool: boolean) {
//         this.id = id;
//         this.asTool = asTool;
//         const agentPath = path.join(WorkDir, "agents", `${id}.json`);
//         const agent = fs.readFileSync(agentPath, "utf8");
//         this.agent = Agent.parse(JSON.parse(agent));
//      }

//     tools(): Record<string, z.infer<typeof ToolAttachment>> {
//         return this.agent.tools ?? {};
//     }

//     async* execute(input: StepInputT): StepOutputT {
//         // console.log("\n\n\t>>>>\t\tinput", JSON.stringify(input));
//         const tools: ToolSet = {};
//         for (const [name, tool] of Object.entries(this.agent.tools ?? {})) {
//             try {
//                 tools[name] = await mapAgentTool(tool);
//             } catch (error) {
//                 console.error(`Error mapping tool ${name}:`, error);
//                 continue;
//             }
//         }

//         // console.log("\n\n\t>>>>\t\ttools", JSON.stringify(tools, null, 2));

//         const provider = getProvider(this.agent.provider);
//         const { fullStream } = streamText({
//             model: provider(this.agent.model || ModelConfig.defaults.model),
//             messages: convertFromMessages(input),
//             system: this.agent.instructions,
//             stopWhen: stepCountIs(1),
//             tools,
//         });


//     }
// }