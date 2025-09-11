import { Db } from "mongodb";
import { API_KEYS_COLLECTION, API_KEYS_INDEXES } from "../repositories/mongodb.api-keys.indexes";
import { PROJECTS_COLLECTION, PROJECTS_INDEXES } from "../repositories/mongodb.projects.indexes";
import { JOBS_COLLECTION, JOBS_INDEXES } from "../repositories/mongodb.jobs.indexes";
import { CONVERSATIONS_COLLECTION, CONVERSATIONS_INDEXES } from "../repositories/mongodb.conversations.indexes";
import { DATA_SOURCES_COLLECTION, DATA_SOURCES_INDEXES } from "../repositories/mongodb.data-sources.indexes";
import { DATA_SOURCE_DOCS_COLLECTION, DATA_SOURCE_DOCS_INDEXES } from "../repositories/mongodb.data-source-docs.indexes";
import { PROJECT_MEMBERS_COLLECTION, PROJECT_MEMBERS_INDEXES } from "../repositories/mongodb.project-members.indexes";
import { RECURRING_JOB_RULES_COLLECTION, RECURRING_JOB_RULES_INDEXES } from "../repositories/mongodb.recurring-job-rules.indexes";
import { SCHEDULED_JOB_RULES_COLLECTION, SCHEDULED_JOB_RULES_INDEXES } from "../repositories/mongodb.scheduled-job-rules.indexes";
import { COMPOSIO_TRIGGER_DEPLOYMENTS_COLLECTION, COMPOSIO_TRIGGER_DEPLOYMENTS_INDEXES } from "../repositories/mongodb.composio-trigger-deployments.indexes";
import { USERS_COLLECTION, USERS_INDEXES } from "../repositories/mongodb.users.indexes";
import { SHARED_WORKFLOWS_COLLECTION, SHARED_WORKFLOWS_INDEXES } from "../repositories/mongodb.shared-workflows.indexes";

export async function ensureAllIndexes(database: Db): Promise<void> {
    await database.collection(API_KEYS_COLLECTION).createIndexes(API_KEYS_INDEXES);
    await database.collection(PROJECTS_COLLECTION).createIndexes(PROJECTS_INDEXES);
    await database.collection(JOBS_COLLECTION).createIndexes(JOBS_INDEXES);
    await database.collection(CONVERSATIONS_COLLECTION).createIndexes(CONVERSATIONS_INDEXES);
    await database.collection(DATA_SOURCES_COLLECTION).createIndexes(DATA_SOURCES_INDEXES);
    await database.collection(DATA_SOURCE_DOCS_COLLECTION).createIndexes(DATA_SOURCE_DOCS_INDEXES);
    await database.collection(PROJECT_MEMBERS_COLLECTION).createIndexes(PROJECT_MEMBERS_INDEXES);
    await database.collection(RECURRING_JOB_RULES_COLLECTION).createIndexes(RECURRING_JOB_RULES_INDEXES);
    await database.collection(SCHEDULED_JOB_RULES_COLLECTION).createIndexes(SCHEDULED_JOB_RULES_INDEXES);
    await database.collection(COMPOSIO_TRIGGER_DEPLOYMENTS_COLLECTION).createIndexes(COMPOSIO_TRIGGER_DEPLOYMENTS_INDEXES);
    await database.collection(USERS_COLLECTION).createIndexes(USERS_INDEXES);
    await database.collection(SHARED_WORKFLOWS_COLLECTION).createIndexes(SHARED_WORKFLOWS_INDEXES);
}
