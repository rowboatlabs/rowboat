import { z } from "zod";
import { Project } from "@/src/entities/models/project";

export interface IProjectsRepository {
    fetch(id: string): Promise<z.infer<typeof Project> | null>;
}