import { IProjectMembersRepository } from "@/src/application/repositories/project-members.repository.interface";
import { projectMembersCollection } from "@/app/lib/mongodb";

export class MongoDBProjectMembersRepository implements IProjectMembersRepository {
    async checkMembership(projectId: string, userId: string): Promise<boolean> {
        const membership = await projectMembersCollection.findOne({
            projectId,
            userId,
        });
        return !!membership;
    }
}