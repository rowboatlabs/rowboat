import { asClass } from "awilix";

import { RedisPubSubService } from "@/src/infrastructure/services/redis.pub-sub.service";
import { S3UploadsStorageService } from "@/src/infrastructure/services/s3.uploads-storage.service";
import { LocalUploadsStorageService } from "@/src/infrastructure/services/local.uploads-storage.service";
import { RedisCacheService } from "@/src/infrastructure/services/redis.cache.service";
import { RedisUsageQuotaPolicy } from "@/src/infrastructure/policies/redis.usage-quota.policy";
import { ProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { JobsWorker } from "@/src/application/workers/jobs.worker";
import { JobRulesWorker } from "@/src/application/workers/job-rules.worker";

export const coreRegistrations = {
    jobsWorker: asClass(JobsWorker).singleton(),
    jobRulesWorker: asClass(JobRulesWorker).singleton(),
    cacheService: asClass(RedisCacheService).singleton(),
    pubSubService: asClass(RedisPubSubService).singleton(),
    s3UploadsStorageService: asClass(S3UploadsStorageService).singleton(),
    localUploadsStorageService: asClass(LocalUploadsStorageService).singleton(),
    usageQuotaPolicy: asClass(RedisUsageQuotaPolicy).singleton(),
    projectActionAuthorizationPolicy: asClass(ProjectActionAuthorizationPolicy).singleton(),
};
