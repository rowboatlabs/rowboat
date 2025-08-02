import { container } from "@/di/container";
import { IStreamTurnController } from "@/src/interface-adapters/controllers/turns/stream-turn.controller";
import { auth0 } from "@/app/lib/auth0";

const streamTurnController = container.resolve<IStreamTurnController>("streamTurnController");

export async function GET(request: Request, props: { params: Promise<{ turnId: string }> }) {
  const { turnId } = await props.params;

  // check session
  const session = await auth0.getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Extract Last-Event-ID header for SSE resuming
  const lastEventId = request.headers.get('Last-Event-ID');
  const lastEventIndex = lastEventId ? parseInt(lastEventId, 10) : undefined;
  
  // Validate the parsed index (must be a non-negative integer)
  const validLastEventIndex = (lastEventIndex !== undefined && !isNaN(lastEventIndex) && lastEventIndex >= 0) 
    ? lastEventIndex 
    : 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Iterate over the generator
        for await (const event of streamTurnController.execute({
          turnId,
          lastEventIndex: validLastEventIndex,
          caller: "user",
          userId: session.user.sub,
        })) {
          // Build SSE message with optional ID field
          let sseMessage = '';
          
          // If this is a message event with an index, include it as the SSE ID
          if (event.type === 'message' && 'index' in event) {
            sseMessage += `id: ${event.index}\n`;
          }
          
          sseMessage += `event: message\ndata: ${JSON.stringify(event)}\n\n`;
          
          controller.enqueue(encoder.encode(sseMessage));
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