import { MessageList } from "../entities/message.js";
import { StreamEvent } from "../entities/stream-event.js";
import { z } from "zod";

export type NodeInputT = z.infer<typeof MessageList>;
export type NodeOutputT = AsyncGenerator<z.infer<typeof StreamEvent>, void, unknown>;

export interface Node {
    execute(input: NodeInputT): NodeOutputT;
}