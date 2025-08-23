import { getCustomerIdForProject, logUsage, UsageTracker } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { redisClient } from "@/app/lib/redis";
import { CopilotAPIRequest } from "@/src/entities/models/copilot";
import { streamMultiAgentResponse } from "@/src/application/lib/copilot/copilot";

export const maxDuration = 300;

export async function GET(request: Request, props: { params: Promise<{ streamId: string }> }) {
  const params = await props.params;
  // get the payload from redis
  const payload = await redisClient.get(`copilot-stream-${params.streamId}`);
  if (!payload) {
    return new Response("Stream not found", { status: 404 });
  }

  // parse the payload
  const { projectId, context, messages, workflow, dataSources } = CopilotAPIRequest.parse(JSON.parse(payload));

  // fetch billing customer id
  let billingCustomerId: string | null = null;
  if (USE_BILLING) {
    billingCustomerId = await getCustomerIdForProject(projectId);
  }

  const usageTracker = new UsageTracker();
  const encoder = new TextEncoder();
  let messageCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Iterate over the copilot stream generator
        for await (const event of streamMultiAgentResponse(
          usageTracker,
          projectId,
          context,
          messages,
          workflow,
          dataSources || [],
        )) {
          // Check if this is a content event
          if ('content' in event) {
            messageCount++;
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(event)}\n\n`));
          } else if ('type' in event && event.type === 'tool-call') {
            controller.enqueue(encoder.encode(`event: tool-call\ndata: ${JSON.stringify(event)}\n\n`));
          } else if ('type' in event && event.type === 'tool-result') {
            controller.enqueue(encoder.encode(`event: tool-result\ndata: ${JSON.stringify(event)}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(event)}\n\n`));
          }
        }
      } catch (error) {
        console.error('Error processing copilot stream:', error);
        controller.error(new Error("Something went wrong. Please try again."));
      } finally {
        // log copilot usage
        if (USE_BILLING && billingCustomerId) {
          try {
            await logUsage(billingCustomerId, {
              items: usageTracker.flush(),
            });
          } catch (error) {
            console.error("Error logging usage", error);
          }
        }
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