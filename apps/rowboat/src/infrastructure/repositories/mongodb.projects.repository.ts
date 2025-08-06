import { IProjectsRepository } from "@/src/application/repositories/projects.repository.interface";
import { Project } from "@/src/entities/models/project";
import { projectsCollection } from "@/app/lib/mongodb";
import { z } from "zod";

const docSchema = Project
    .omit({
        id: true,
    })
    .extend({
        id: z.string().uuid(),
    });

export class MongodbProjectsRepository implements IProjectsRepository {
    async fetch(id: string): Promise<z.infer<typeof docSchema> | null> {
        const doc = await projectsCollection.findOne({ _id: id });
        if (!doc) {
            return null;
        }
        const { _id, ...rest } = doc;
        return {
            ...rest,
            id: _id.toString(),
        }
    }
}