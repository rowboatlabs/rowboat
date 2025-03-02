import { MongoClient } from "mongodb";
import { PlaygroundChat, Webpage, ChatClientId } from "./types/types";
import { Workflow } from "./types/workflow_types";
import { ApiKey } from "./types/project_types";
import { ProjectMember } from "./types/project_types";
import { Project } from "./types/project_types";
import { EmbeddingDoc } from "./types/datasource_types";
import { DataSourceDoc } from "./types/datasource_types";
import { DataSource } from "./types/datasource_types";
import { Scenario, SimulationResult, SimulationRun, SimulationAggregateResult } from "./types/testing_types";
import { TwilioConfig } from "./types/voice_types";
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
export const scenariosCollection = db.collection<z.infer<typeof Scenario>>("scenarios");
export const apiKeysCollection = db.collection<z.infer<typeof ApiKey>>("api_keys");
export const simulationRunsCollection = db.collection<z.infer<typeof SimulationRun>>("simulation_runs");
export const simulationResultsCollection = db.collection<z.infer<typeof SimulationResult>>("simulation_results");
export const twilioConfigsCollection = db.collection<z.infer<typeof TwilioConfig>>("twilio_configs");

// Create indexes
twilioConfigsCollection.createIndexes([
    {
        key: { workflow_id: 1, status: 1 },
        name: "workflow_status_idx",
        // This ensures only one active config per workflow
        unique: true,
        partialFilterExpression: { status: "active" }
    }
]);