import { z } from "zod";
import { Project as ExistingProjectSchema } from "@/app/lib/types/project_types";

export const Project = ExistingProjectSchema
    .omit({
        _id: true,
    })
    .extend({
        id: z.string().uuid(),
    });