import { ExecutionProfile } from "@x/shared/dist/execution-profile.js";
import { ILlmService } from "./llm-service.js";
import { IGmailService } from "./gmail-service.js";
import { ISttService } from "./stt-service.js";
import { IComposioService } from "./composio-service.js";
import { LocalLlmService } from "./local/local-llm-service.js";
import { LocalGmailService } from "./local/local-gmail-service.js";
import { LocalSttService } from "./local/local-stt-service.js";
import { LocalComposioService } from "./local/local-composio-service.js";

export interface ExecutionServices {
    llm: ILlmService;
    gmail: IGmailService;
    stt: ISttService;
    composio: IComposioService;
}

export function createServices(profile: ExecutionProfile): ExecutionServices {
    switch (profile.mode) {
        case "local":
            return {
                llm: new LocalLlmService(),
                gmail: new LocalGmailService(),
                stt: new LocalSttService(),
                composio: new LocalComposioService(),
            };
        default:
            throw new Error(`Unsupported execution profile mode: ${(profile as { mode: string }).mode}`);
    }
}
