export interface IApiKeysRepository {
    checkAndConsumeKey(projectId: string, apiKey: string): Promise<boolean>;
}