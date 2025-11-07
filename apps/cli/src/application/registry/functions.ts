import { GetDate } from "../functions/get_date.js";
import { Step } from "../lib/step.js";

export const FunctionsRegistry: Record<string, Step> = {
    get_date: new GetDate(),
} as const;