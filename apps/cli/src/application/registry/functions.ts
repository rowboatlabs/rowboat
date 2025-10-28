import { GetDate } from "../functions/get_date.js";
import { Node } from "../nodes/node.js";

export const FunctionsRegistry: Record<string, Node> = {
    get_date: new GetDate(),
} as const;