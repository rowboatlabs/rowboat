"use server";

import { container } from "@/di/container";
import { ICreateScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/create-scheduled-job-rule.controller";
import { IListScheduledJobRulesController } from "@/src/interface-adapters/controllers/scheduled-job-rules/list-scheduled-job-rules.controller";
import { IFetchScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/fetch-scheduled-job-rule.controller";
import { IDeleteScheduledJobRuleController } from "@/src/interface-adapters/controllers/scheduled-job-rules/delete-scheduled-job-rule.controller";
import { authCheck } from "./auth_actions";
import { z } from "zod";
import { Message } from "@/app/lib/types/types";

const createScheduledJobRuleController = container.resolve<ICreateScheduledJobRuleController>('createScheduledJobRuleController');
const listScheduledJobRulesController = container.resolve<IListScheduledJobRulesController>('listScheduledJobRulesController');
const fetchScheduledJobRuleController = container.resolve<IFetchScheduledJobRuleController>('fetchScheduledJobRuleController');
const deleteScheduledJobRuleController = container.resolve<IDeleteScheduledJobRuleController>('deleteScheduledJobRuleController');

export async function createScheduledJobRule(request: {
    projectId: string,
    input: {
        messages: z.infer<typeof Message>[],
    },
    scheduledTime: string, // ISO datetime string
}) {
    const user = await authCheck();

    return await createScheduledJobRuleController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        input: request.input,
        scheduledTime: request.scheduledTime,
    });
}

export async function listScheduledJobRules(request: {
    projectId: string,
    cursor?: string,
    limit?: number,
}) {
    const user = await authCheck();

    return await listScheduledJobRulesController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        cursor: request.cursor,
        limit: request.limit,
    });
}

export async function fetchScheduledJobRule(request: {
    ruleId: string,
}) {
    const user = await authCheck();

    return await fetchScheduledJobRuleController.execute({
        caller: 'user',
        userId: user._id,
        ruleId: request.ruleId,
    });
}

export async function deleteScheduledJobRule(request: {
    projectId: string,
    ruleId: string,
}) {
    const user = await authCheck();

    return await deleteScheduledJobRuleController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        ruleId: request.ruleId,
    });
}