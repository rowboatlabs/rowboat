import { container } from "@/di/container";
import { IRunCopilotCachedTurnController } from "@/src/interface-adapters/controllers/copilot/run-copilot-cached-turn.controller";
import { requireAuth } from "@/app/lib/auth";

export const maxDuration = 300;

export async function GET(request: Request, props: { params: Promise<{ streamId: string }> }) {
  const params = await props.params;

  // get user data
  const user = await requireAuth();

  const runCopilotCachedTurnController = container.resolve<IRunCopilotCachedTurnController>("runCopilotCachedTurnController");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Iterate over the copilot stream generator
        for await (const event of runCopilotCachedTurnController.execute({
          caller: "user",
          userId: user.id,
          apiKey: request.headers.get("Authorization")?.split(" ")[1],
          key: params.streamId,
        })) {
          // Check if this is a content event
          if ('content' in event) {
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
          } else if ('type' in event && event.type === 'tool-call') {
            controller.enqueue(encoder.encode(`event: tool-call\ndata: ${JSON.stringify(event)}\n\n`));
          } else if ('type' in event && event.type === 'tool-result') {
            controller.enqueue(encoder.encode(`event: tool-result\ndata: ${JSON.stringify(event)}\n\n`));
          }
        }
      } catch (error) {
        console.error('Error processing copilot stream:', error);
        controller.error(new Error("Something went wrong. Please try again."));
      } finally {
        console.log("closing stream");
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`));
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