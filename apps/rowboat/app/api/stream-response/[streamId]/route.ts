import { getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { redisClient } from "@/app/lib/redis";
import { streamResponse } from "@/app/lib/agents";
import { ZRunConversationTurnStreamPayload } from "@/app/lib/types/types";
import { container } from "@/di/container";
import { IRunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
import { requireAuth } from "@/app/lib/auth";

export async function GET(request: Request, props: { params: Promise<{ streamId: string }> }) {
  const params = await props.params;

  // get user data
  const user = await requireAuth();

  // get the payload from redis
  const payload = await redisClient.get(`chat-stream-${params.streamId}`);
  if (!payload) {
    return new Response("Stream not found", { status: 404 });
  }

  // parse the payload
  const { conversationId, workflow, messages } = ZRunConversationTurnStreamPayload.parse(JSON.parse(payload));
  console.log('payload', payload);
  const encoder = new TextEncoder();

  const runPlaygroundChatTurnController = container.resolve<IRunCachedTurnController>("runPlaygroundChatTurnController");

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Iterate over the generator
        for await (const event of runPlaygroundChatTurnController.execute({
          userId: user._id,
          apiKey: undefined,
          conversationId,
          workflow,
        })) {
          // Check if this is a message event (has role property)
          if ('role' in event) {
            if (event.role === 'assistant') {
              messageCount++;
            }
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(event)}\n\n`));
          }
        }

        controller.close();

        // Log billing usage
        if (USE_BILLING && billingCustomerId) {
          await logUsage(billingCustomerId, {
            type: "agent_messages",
            amount: messageCount,
          });
        }
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