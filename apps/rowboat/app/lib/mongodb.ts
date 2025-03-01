import { MongoClient } from "mongodb";
import { Webpage } from "./types/types";
import { Workflow } from "./types/workflow_types";
import { ApiKey } from "./types/project_types";
import { ProjectMember } from "./types/project_types";
import { Project } from "./types/project_types";
import { EmbeddingDoc } from "./types/datasource_types";
import { DataSourceDoc } from "./types/datasource_types";
import { DataSource } from "./types/datasource_types";
import { TestScenario, TestResult, TestRun, TestProfile, TestSimulation } from "./types/testing_types";
import { z } from 'zod';

const client = new MongoClient(process.env["MONGODB_CONNECTION_STRING"] || "mongodb://localhost:27017");

export const db = client.db("rowboat");
export const dataSourcesCollection = db.collection<z.infer<typeof DataSource>>("sources");
export const dataSourceDocsCollection = db.collection<z.infer<typeof DataSourceDoc>>("source_docs");
export const embeddingsCollection = db.collection<z.infer<typeof EmbeddingDoc>>("embeddings");
export const projectsCollection = db.collection<z.infer<typeof Project>>("projects");
export const projectMembersCollection = db.collection<z.infer<typeof ProjectMember>>("project_members");
export const webpagesCollection =  db.collection<z.infer<typeof Webpage>>('webpages');
export const agentWorkflowsCollection = db.collection<z.infer<typeof Workflow>>("agent_workflows");
export const apiKeysCollection = db.collection<z.infer<typeof ApiKey>>("api_keys");
export const testScenariosCollection = db.collection<z.infer<typeof TestScenario>>("test_scenarios");
export const testProfilesCollection = db.collection<z.infer<typeof TestProfile>>("test_profiles");
export const testSimulationsCollection = db.collection<z.infer<typeof TestSimulation>>("test_simulations");
export const testRunsCollection = db.collection<z.infer<typeof TestRun>>("test_runs");
export const testResultsCollection = db.collection<z.infer<typeof TestResult>>("test_results");