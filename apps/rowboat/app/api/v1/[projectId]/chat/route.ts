import { z } from "zod";
import { ApiResponse } from "@/app/lib/types/api_types";
import { ApiRequest } from "@/app/lib/types/api_types";
import { PrefixLogger } from "../../../../lib/utils";
import { IRunTurnController } from "@/src/interface-adapters/controllers/conversations/run-turn.controller";

type ChatRouteContext = { params: Promise<{ projectId: string }> };

interface LoggerLike {
    log(message: string): void;
}

interface ChatRouteDependencies {
    createLogger(requestId: string): LoggerLike;
    resolveRunTurnController(): IRunTurnController | Promise<IRunTurnController>;
}

const defaultDependencies: ChatRouteDependencies = {
    createLogger: (requestId) => new PrefixLogger(`${requestId}`),
    resolveRunTurnController: async () => {
        const { container } = await import("@/di/container");
        return container.resolve<IRunTurnController>("runTurnController");
    },
};

// get next turn / agent response
export async function handlePostChat(
    req: Request,
    { params }: ChatRouteContext,
    deps: ChatRouteDependencies = defaultDependencies,
): Promise<Response> {
    const { projectId } = await params;
    const requestId = crypto.randomUUID();
    const logger = deps.createLogger(requestId);

    // parse and validate the request body
    let data: z.infer<typeof ApiRequest>;
    try {
        const body = await req.json();
        data = ApiRequest.parse(body);
    } catch (e) {
        logger.log(`Invalid JSON in request body: ${e}`);
        return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const { conversationId, messages, mockTools, stream } = data;

    const runTurnController = await deps.resolveRunTurnController();

    // get assistant response
    const response = await runTurnController.execute({
        caller: "api",
        apiKey: req.headers.get("Authorization")?.split(" ")[1],
        projectId,
        input: {
            messages,
            mockTools,
        },
        conversationId: conversationId || undefined,
        stream: Boolean(stream),
    });

    // if streaming is requested, return SSE stream
    if (stream && 'stream' in response) {
        const encoder = new TextEncoder();
        
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    // Iterate over the generator
                    for await (const event of response.stream) {
                        controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
                    }
                    controller.close();
                } catch (error) {
                    logger.log(`Error processing stream: ${error}`);
                    controller.error(new Error("Something went wrong. Please try again."));
                }
            },
        });
        
        return new Response(readableStream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });
    }

    // non-streaming response (existing behavior)
    if (!('turn' in response)) {
        logger.log(`No turn data found in response`);
        return Response.json({ error: "No turn data found in response" }, { status: 500 });
    }

    const responseBody: z.infer<typeof ApiResponse> = {
        conversationId: response.conversationId,
        turn: response.turn,
    };
    return Response.json(responseBody);
}

export async function POST(req: Request, context: ChatRouteContext): Promise<Response> {
    return handlePostChat(req, context);
}
