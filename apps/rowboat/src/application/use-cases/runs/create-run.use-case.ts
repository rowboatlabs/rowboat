import { IRunsRepository } from "@/src/application/repositories/runs.repository.interface";
import { Run } from "@/src/entities/models/run";
import { CreateRunData } from "../../repositories/runs.repository.interface";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { authorize, getCustomerIdForProject } from "@/app/lib/billing";
import { BadRequestError, BillingError, NotAuthorizedError } from '@/src/entities/errors/common';
import { check_query_limit } from "@/app/lib/rate_limiting";
import { QueryLimitError } from "@/src/entities/errors/common";
import { apiKeysCollection, projectMembersCollection } from "@/app/lib/mongodb";
import { z } from "zod";

const inputSchema = z.object({
    runData: CreateRunData,
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
});

export interface ICreateRunUseCase {
    execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Run>>;
}

export class CreateRunUseCase implements ICreateRunUseCase {
    private readonly runsRepository: IRunsRepository;

    constructor({ runsRepository }: { runsRepository: IRunsRepository }) {
        this.runsRepository = runsRepository;
    }

    async execute(data: z.infer<typeof inputSchema>): Promise<z.infer<typeof Run>> {
        const { projectId } = data.runData;

        // if caller is a user, ensure they are a member of project
        if (data.caller === "user") {
            if (!data.userId) {
                throw new BadRequestError('User ID is required');
            }
            const membership = await projectMembersCollection.findOne({
                projectId,
                userId: data.userId,
            });
            if (!membership) {
                throw new NotAuthorizedError('User not a member of project');
            }
        } else {
            if (!data.apiKey) {
                throw new BadRequestError('API key is required');
            }
            // check if api key is valid
            // while also updating last used timestamp
            const result = await apiKeysCollection.findOneAndUpdate(
                {
                    projectId,
                    key: data.apiKey,
                },
                { $set: { lastUsedAt: new Date().toISOString() } }
            );
            if (!result) {
                throw new NotAuthorizedError('Invalid API key');
            }
        }

        // check query limit for project
        if (!await check_query_limit(projectId)) {
            throw new QueryLimitError('Query limit exceeded');
        }

        // Check billing auth
        if (USE_BILLING) {
            // get billing customer id for project
            const customerId = await getCustomerIdForProject(projectId);
            const agentModels = data.runData.workflow.agents.reduce((acc, agent) => {
                acc.push(agent.model);
                return acc;
            }, [] as string[]);
            const response = await authorize(customerId, {
                type: 'agent_response',
                data: {
                    agentModels,
                },
            });
            if (!response.success) {
                throw new BillingError(response.error || 'Billing error');
            }
        }

        // set timestamps where missing
        data.runData.messages.forEach(msg => {
            if (!msg.timestamp) {
                msg.timestamp = new Date().toISOString();
            }
        });

        // create run
        return await this.runsRepository.createRun(data.runData);
    }
}