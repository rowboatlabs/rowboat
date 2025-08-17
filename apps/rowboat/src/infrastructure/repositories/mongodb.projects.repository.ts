import { db } from "@/app/lib/mongodb";
import { CreateSchema, IProjectsRepository, AddComposioConnectedAccountSchema, AddCustomMcpServerSchema } from "@/src/application/repositories/projects.repository.interface";
import { NotFoundError } from "@/src/entities/errors/common";
import { Project } from "@/src/entities/models/project";
import { z } from "zod";

const docSchema = Project
    .omit({
        id: true,
    })
    .extend({
        _id: z.string().uuid(),
    });

export class MongodbProjectsRepository implements IProjectsRepository {
    private collection = db.collection<z.infer<typeof docSchema>>('projects');

    async create(data: z.infer<typeof CreateSchema>): Promise<z.infer<typeof Project>> {
        const id = crypto.randomUUID();
        const doc = {
            ...data,
            createdAt: new Date().toISOString(),
        };
        await this.collection.insertOne({
            ...doc,
            _id: id,
        });
        return {
            ...doc,
            id,
        };
    }

    async fetch(id: string): Promise<z.infer<typeof Project> | null> {
        const doc = await this.collection.findOne({ _id: id });
        if (!doc) {
            return null;
        }
        const { _id, ...rest } = doc;
        return {
            ...rest,
            id,
        };
    }

    async addComposioConnectedAccount(projectId: string, data: z.infer<typeof AddComposioConnectedAccountSchema>): Promise<z.infer<typeof Project>> {
        const key = `composioConnectedAccounts.${data.toolkitSlug}`;
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    [key]: data.data,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async deleteComposioConnectedAccount(projectId: string, toolkitSlug: string): Promise<boolean> {
        const result = await this.collection.updateOne({
            _id: projectId,
        }, {
            $unset: {
                [`composioConnectedAccounts.${toolkitSlug}`]: "",
            }
        });
        return result.modifiedCount > 0;
    }

    async addCustomMcpServer(projectId: string, data: z.infer<typeof AddCustomMcpServerSchema>): Promise<z.infer<typeof Project>> {
        const key = `customMcpServers.${data.name}`;
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    [key]: data.data,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async deleteCustomMcpServer(projectId: string, name: string): Promise<boolean> {
        const result = await this.collection.updateOne({
            _id: projectId,
        }, {
            $unset: {
                [`customMcpServers.${name}`]: "",
            }
        });
        return result.modifiedCount > 0;
    }

    async updateSecret(projectId: string, secret: string): Promise<z.infer<typeof Project>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    secret,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async updateWebhookUrl(projectId: string, url: string): Promise<z.infer<typeof Project>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    webhookUrl: url,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async updateName(projectId: string, name: string): Promise<z.infer<typeof Project>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    name,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async updateDraftWorkflow(projectId: string, workflow: z.infer<typeof import("@/app/lib/types/workflow_types").Workflow>): Promise<z.infer<typeof Project>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    draftWorkflow: workflow,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async updateLiveWorkflow(projectId: string, workflow: z.infer<typeof import("@/app/lib/types/workflow_types").Workflow>): Promise<z.infer<typeof Project>> {
        const result = await this.collection.findOneAndUpdate(
            { _id: projectId },
            {
                $set: {
                    liveWorkflow: workflow,
                    lastUpdatedAt: new Date().toISOString(),
                }
            },
            { returnDocument: 'after' }
        );
        if (!result) {
            throw new NotFoundError('Project not found');
        }
        const { _id, ...rest } = result;
        return { ...rest, id: _id };
    }

    async delete(projectId: string): Promise<boolean> {
        const result = await this.collection.deleteOne({ _id: projectId });
        return result.deletedCount > 0;
    }
}