import { IndexDescription } from "mongodb";

export const SHARED_WORKFLOWS_COLLECTION = "shared_workflows";

export const SHARED_WORKFLOWS_INDEXES: IndexDescription[] = [
  { key: { expiresAt: 1 }, name: "expiresAt_ttl", expireAfterSeconds: 0 },
];

