import { BadRequestError, NotAuthorizedError } from "@/src/entities/errors/common";
import { IProjectMembersRepository } from "../repositories/project-members.repository.interface";
import { z } from "zod";
import { IApiKeysRepository } from "../repositories/api-keys.repository.interface";

const inputSchema = z.object({
    caller: z.enum(["user", "api"]),
    userId: z.string().optional(),
    apiKey: z.string().optional(),
    projectId: z.string(),
});

export interface IProjectActionAuthorizationPolicy {
    authorize(data: z.infer<typeof inputSchema>): Promise<void>;
}

export class ProjectActionAuthorizationPolicy implements IProjectActionAuthorizationPolicy {
    private readonly projectMembersRepository: IProjectMembersRepository;
    private readonly apiKeysRepository: IApiKeysRepository;

    constructor({
        projectMembersRepository,
        apiKeysRepository,
    }: {
        projectMembersRepository: IProjectMembersRepository;
        apiKeysRepository: IApiKeysRepository;
    }) {
        this.projectMembersRepository = projectMembersRepository;
        this.apiKeysRepository = apiKeysRepository;
    }

    async authorize(data: z.infer<typeof inputSchema>): Promise<void> {
        const { caller, userId, apiKey, projectId } = data;

        if (caller === "user") {
            if (!userId) {
                throw new BadRequestError('User ID is required');
            }
            const membership = await this.projectMembersRepository.checkMembership(projectId, userId);
            if (!membership) {
                throw new NotAuthorizedError('User is not a member of the project');
            }
        } else {
            if (!apiKey) {
                throw new BadRequestError('API key is required');
            }
            // check and consume api key
            // while also updating last used timestamp
            const result = await this.apiKeysRepository.checkAndConsumeKey(projectId, apiKey);
            if (!result) {
                throw new NotAuthorizedError('Invalid API key');
            }
        }
    }
}