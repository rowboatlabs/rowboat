import { MongoClient } from "mongodb";
import { User } from "./types/types";
import { Workflow } from "./types/workflow_types";
import { Project } from "./types/project_types";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { TwilioConfig, TwilioInboundCall } from "./types/voice_types";
import { z } from 'zod';
import { apiV1 } from "rowboat-shared";

const client = new MongoClient(process.env["MONGODB_CONNECTION_STRING"] || "mongodb://localhost:27017");

export const db = client.db("rowboat");
export const dataSourceDocsCollection = db.collection<z.infer<typeof DataSourceDoc>>("source_docs");
export const projectsCollection = db.collection<z.infer<typeof Project>>("projects");
export const agentWorkflowsCollection = db.collection<z.infer<typeof Workflow>>("agent_workflows");
export const chatsCollection = db.collection<z.infer<typeof apiV1.Chat>>("chats");
export const chatMessagesCollection = db.collection<z.infer<typeof apiV1.ChatMessage>>("chat_messages");
export const twilioConfigsCollection = db.collection<z.infer<typeof TwilioConfig>>("twilio_configs");
export const usersCollection = db.collection<z.infer<typeof User>>("users");
export const twilioInboundCallsCollection = db.collection<z.infer<typeof TwilioInboundCall>>("twilio_inbound_calls");

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