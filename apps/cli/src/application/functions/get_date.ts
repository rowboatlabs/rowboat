import { Node, NodeOutputT } from "../nodes/node.js";

export class GetDate implements Node {
    async* execute(): NodeOutputT {
        yield {
            type: "text-start",
        };
        yield {
            type: "text-delta",
            delta: 'The current date is ' + new Date().toISOString(),
        };
        yield {
            type: "text-end",
        };
    }
}