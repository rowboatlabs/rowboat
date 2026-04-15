import { createContainer, InjectionMode } from "awilix";

import { coreRegistrations } from "@/di/modules/core";
import { apiKeyRegistrations } from "@/di/modules/api-keys";
import { dataSourceRegistrations } from "@/di/modules/data-sources";
import { jobRegistrations } from "@/di/modules/jobs";
import { projectRegistrations } from "@/di/modules/projects";
import { composioRegistrations } from "@/di/modules/composio";
import { conversationRegistrations } from "@/di/modules/conversations";
import { copilotRegistrations } from "@/di/modules/copilot";
import { userRegistrations } from "@/di/modules/users";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    ...coreRegistrations,
    ...projectRegistrations,
    ...apiKeyRegistrations,
    ...dataSourceRegistrations,
    ...jobRegistrations,
    ...composioRegistrations,
    ...conversationRegistrations,
    ...copilotRegistrations,
    ...userRegistrations,
});
