import { z } from "zod";
import crypto from 'crypto';
import { IProjectsRepository } from "../../repositories/projects.repository.interface";
import { IUsageQuotaPolicy } from "../../policies/usage-quota.policy.interface";
import { BadRequestError, BillingError } from "@/src/entities/errors/common";
import { IProjectMembersRepository } from "../../repositories/project-members.repository.interface";
import { authorize, getCustomerForUserId } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { Project } from "@/src/entities/models/project";
import { Workflow } from "@/app/lib/types/workflow_types";
import { templates } from "@/app/lib/project_templates";

export const Mode = z.union([
    z.object({
        template: z.string(),
    }),
    z.object({
        workflowJson: z.string(),
    }),
])

export const InputSchema = z.object({
    userId: z.string(),
    data: z.object({
        name: z.string().optional(),
        mode: Mode,
    }),
});

const workflowSchema = Workflow.omit({ lastUpdatedAt: true });

export interface ICreateProjectUseCase {
    execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof Project>>;
}

export class CreateProjectUseCase implements ICreateProjectUseCase {
    private readonly projectsRepository: IProjectsRepository;
    private readonly projectMembersRepository: IProjectMembersRepository;
    private readonly usageQuotaPolicy: IUsageQuotaPolicy;

    constructor({
        projectsRepository,
        projectMembersRepository,
        usageQuotaPolicy,
    }: {
        projectsRepository: IProjectsRepository,
        projectMembersRepository: IProjectMembersRepository,
        usageQuotaPolicy: IUsageQuotaPolicy,
    }) {
        this.projectsRepository = projectsRepository;
        this.projectMembersRepository = projectMembersRepository;
        this.usageQuotaPolicy = usageQuotaPolicy;
    }

    async execute(request: z.infer<typeof InputSchema>): Promise<z.infer<typeof Project>> {
        // fetch current project count for this user
        const count = await this.projectsRepository.countCreatedProjects(request.userId);

        // Check billing auth
        if (USE_BILLING) {
            // get billing customer id for project
            const customer = await getCustomerForUserId(request.userId);
            if (!customer) {
                throw new BillingError("User has no billing customer id");
            }

            // validate enough credits
            const result = await authorize(customer._id, {
                type: "create_project",
                data: {
                    existingProjectCount: count,
                },
            });
            if (!result.success) {
                throw new BillingError(result.error || 'Billing error');
            }
        }

        // generate workflow based on input
        let workflow: z.infer<typeof workflowSchema>;
        if ('template' in request.data.mode) {
            const template = templates[request.data.mode.template] || templates.default;
            workflow = {
                agents: template.agents,
                prompts: template.prompts,
                tools: template.tools,
                startAgent: template.startAgent,
            }
        } else {
            try {
                workflow = workflowSchema.parse(JSON.parse(request.data.mode.workflowJson));
            } catch (error) {
                throw new BadRequestError('Invalid workflow JSON');
            }
        }

        // create project secret
        const secret = crypto.randomBytes(32).toString('hex');

        // create project
        const project = await this.projectsRepository.create({
            ...request.data,
            workflow,
            createdByUserId: request.userId,
            name: request.data.name || `Assistant ${count + 1}`,
            secret,
        });

        // create membership
        await this.projectMembersRepository.create({
            projectId: project.id,
            userId: request.userId,
        });

        // assert and consume quota
        await this.usageQuotaPolicy.assertAndConsume(project.id);

        return project;
    }
}