"use server";

import { container } from "@/di/container";
import { ICreateRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/create-recurring-job-rule.controller";
import { IListRecurringJobRulesController } from "@/src/interface-adapters/controllers/recurring-job-rules/list-recurring-job-rules.controller";
import { IFetchRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/fetch-recurring-job-rule.controller";
import { IToggleRecurringJobRuleController } from "@/src/interface-adapters/controllers/recurring-job-rules/toggle-recurring-job-rule.controller";
import { authCheck } from "./auth_actions";
import { z } from "zod";
import { Message } from "@/app/lib/types/types";

const createRecurringJobRuleController = container.resolve<ICreateRecurringJobRuleController>('createRecurringJobRuleController');
const listRecurringJobRulesController = container.resolve<IListRecurringJobRulesController>('listRecurringJobRulesController');
const fetchRecurringJobRuleController = container.resolve<IFetchRecurringJobRuleController>('fetchRecurringJobRuleController');
const toggleRecurringJobRuleController = container.resolve<IToggleRecurringJobRuleController>('toggleRecurringJobRuleController');

export async function createRecurringJobRule(request: {
    projectId: string,
    input: {
        messages: z.infer<typeof Message>[],
    },
    cron: string,
}) {
    const user = await authCheck();

    return await createRecurringJobRuleController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        input: request.input,
        cron: request.cron,
    });
}

export async function listRecurringJobRules(request: {
    projectId: string,
    cursor?: string,
    limit?: number,
}) {
    const user = await authCheck();

    return await listRecurringJobRulesController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        cursor: request.cursor,
        limit: request.limit,
    });
}

export async function fetchRecurringJobRule(request: {
    ruleId: string,
}) {
    const user = await authCheck();

    return await fetchRecurringJobRuleController.execute({
        caller: 'user',
        userId: user._id,
        ruleId: request.ruleId,
    });
}

export async function toggleRecurringJobRule(request: {
    ruleId: string,
    disabled: boolean,
}) {
    const user = await authCheck();

    return await toggleRecurringJobRuleController.execute({
        caller: 'user',
        userId: user._id,
        ruleId: request.ruleId,
        disabled: request.disabled,
    });
}
