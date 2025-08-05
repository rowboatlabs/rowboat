import { IProjectMembersRepository } from "@/src/application/repositories/project-members.repository.interface";
import { db } from "@/app/lib/mongodb";

export class MongoDBProjectMembersRepository implements IProjectMembersRepository {
    async checkMembership(projectId: string, userId: string): Promise<boolean> {
        const membership = await db.collection('project_members').findOne({
            projectId,
            userId,
        });
        return !!membership;
    }
}