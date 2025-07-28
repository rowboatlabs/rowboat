import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { ICreateRunUseCase } from "@/src/application/use-cases/runs/create-run.use-case";
import { Run } from "@/src/entities/models/run";
import { BadRequestError } from "@/src/entities/errors/common";
import z from "zod";

const inputSchema = z.object({
    userId: z.string(),
    projectId: z.string(),
    messages: z.array(Message),
    workflow: Workflow,
    isLiveWorkflow: z.boolean(),
});

export interface ICreatePlaygroundChatRunController {
    execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Run>>;
}

export class CreatePlaygroundChatRunController implements ICreatePlaygroundChatRunController {
    private readonly createRunUseCase: ICreateRunUseCase;

    constructor({ createRunUseCase }: { createRunUseCase: ICreateRunUseCase }) {
        this.createRunUseCase = createRunUseCase;
    }

    async execute(request: z.infer<typeof inputSchema>): Promise<z.infer<typeof Run>> {
        // parse input
        const result = inputSchema.safeParse(request);
        if (!result.success) {
            throw new BadRequestError(`Invalid request: ${JSON.stringify(result.error)}`);
        }

        // execute use case
        return this.createRunUseCase.execute({
            caller: "user",
            userId: result.data.userId,
            runData: {
                trigger: "chat",
                triggerData: {
                    messages: result.data.messages,
                },
                projectId: result.data.projectId,
                messages: result.data.messages,
                workflow: result.data.workflow,
                isLiveWorkflow: result.data.isLiveWorkflow,
            },
        });
    }
}