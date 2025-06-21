import { getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { redisClient } from "@/app/lib/redis";
import { Workflow, WorkflowTool } from "@/app/lib/types/workflow_types";
import { generateAgenticResponse } from "@/app/lib/agents";
import { Message } from "@/app/lib/types/types";
import { z } from "zod";

const PayloadSchema = z.object({
  workflow: Workflow,
  projectTools: z.array(WorkflowTool),
  messages: z.array(Message),
});

export async function GET(request: Request, { params }: { params: { streamId: string } }) {
  // get the payload from redis
  const payload = await redisClient.get(`chat-stream-${params.streamId}`);
  if (!payload) {
    return new Response("Stream not found", { status: 404 });
  }

  // parse the payload
  const { workflow, projectTools, messages } = PayloadSchema.parse(JSON.parse(payload));
  console.log('payload', payload);

  // fetch billing customer id
  let billingCustomerId: string | null = null;
  if (USE_BILLING) {
    billingCustomerId = await getCustomerIdForProject(workflow.projectId);
  }

  const encoder = new TextEncoder();
  let messageCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Iterate over the generator
        for await (const event of generateAgenticResponse(workflow, projectTools, messages)) {
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