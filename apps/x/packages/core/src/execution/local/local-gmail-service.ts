import { IGmailService } from "../gmail-service.js";
import { init, triggerSync } from "../../knowledge/sync_gmail.js";

export class LocalGmailService implements IGmailService {
    init(): void {
        init();
    }

    triggerSync(): void {
        triggerSync();
    }
}
