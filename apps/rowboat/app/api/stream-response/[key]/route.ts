import { container } from "@/di/container";
import { IRunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
import { requireAuth } from "@/app/lib/auth";

export async function GET(request: Request, props: { params: Promise<{ key: string }> }) {
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
                    cachedTurnKey: params.key,
                })) {
                    controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
                }
                controller.close();
            } catch (error) {
                console.error('Error processing stream:', error);
                controller.error(error);
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