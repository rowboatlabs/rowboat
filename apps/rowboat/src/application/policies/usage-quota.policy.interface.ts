export interface IUsageQuotaPolicy {
    // this method will throw a QuotaExceededError if the quota is exceeded
    assertAndConsume(projectId: string): Promise<void>;
}