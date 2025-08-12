import { container } from "@/di/container";
import { IRunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
import { requireAuth } from "@/app/lib/auth";
import { z } from "zod";
import { TurnEvent } from "@/src/entities/models/turn";

export async function GET(request: Request, props: { params: Promise<{ streamId: string }> }) {
    const params = await props.params;
    
    // get user data
    const user = await requireAuth();
    
    const runCachedTurnController = container.resolve<IRunCachedTurnController>("runCachedTurnController");
    
    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
        async start(controller) {
            try {
                // Iterate over the generator
                for await (const event of runCachedTurnController.execute({
                    caller: "user",
                    userId: user._id,
                    cachedTurnKey: params.streamId,
                })) {
                    controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
                }
            } catch (error) {
                console.error('Error processing stream:', error);
                const errMessage: z.infer<typeof TurnEvent> = {
                    type: "error",
                    error: `Error processing stream: ${error}`,
                    isBillingError: false,
                };
                controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(errMessage)}\n\n`));
            } finally {
                console.log("closing stream");
                controller.enqueue(encoder.encode("event: end\n\n"));
                controller.close();
            }
        },
    });
    
    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}