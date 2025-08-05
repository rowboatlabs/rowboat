export interface IProjectMembersRepository {
    checkMembership(projectId: string, userId: string): Promise<boolean>;
}