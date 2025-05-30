import { getCustomerIdForProject, logUsage } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { redisClient } from "@/app/lib/redis";
import { AgenticAPIChatMessage, AgenticAPIChatRequest, convertFromAgenticAPIChatMessages } from "@/app/lib/types/agents_api_types";
import { createParser, type EventSourceMessage } from 'eventsource-parser';

export async function GET(request: Request, { params }: { params: { streamId: string } }) {
  // get the payload from redis
  const payload = await redisClient.get(`chat-stream-${params.streamId}`);
  if (!payload) {
    return new Response("Stream not found", { status: 404 });
  }

  // parse the payload
  const parsedPayload = AgenticAPIChatRequest.parse(JSON.parse(payload));

  // fetch billing customer id
  let billingCustomerId: string | null = null;
  if (USE_BILLING) {
    billingCustomerId = await getCustomerIdForProject(parsedPayload.projectId);
  }

  // Fetch the upstream SSE stream.
  const upstreamResponse = await fetch(`${process.env.AGENTS_API_URL}/chat_stream`, {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.AGENTS_API_KEY || 'test'}`,
    },
    cache: 'no-store',
  });

  // If the upstream request fails, return a 502 Bad Gateway.
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response("Error connecting to upstream SSE stream", { status: 502 });
  }

  const reader = upstreamResponse.body.getReader();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let messageCount = 0;

      function emitEvent(event: EventSourceMessage) {
        // Re-emit the event in SSE format
        let eventString = '';
        if (event.id) eventString += `id: ${event.id}\n`;
        if (event.event) eventString += `event: ${event.event}\n`;
        if (event.data) eventString += `data: ${event.data}\n`;
        eventString += '\n';

        controller.enqueue(encoder.encode(eventString));
      }

      const parser = createParser({
        onEvent(event: EventSourceMessage) {
          if (event.event !== 'message') {
            emitEvent(event);
            return;
          }

          // Parse message
          const data = JSON.parse(event.data);
          const msg = AgenticAPIChatMessage.parse(data);
          const parsedMsg = convertFromAgenticAPIChatMessages([msg])[0];

          // increment the message count if this is an assistant message
          if (parsedMsg.role === 'assistant') {
            messageCount++;
          }

          // emit the event
          emitEvent(event);
        }
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Feed the chunk to the parser
          parser.feed(new TextDecoder().decode(value));
        }
        controller.close();

        if (USE_BILLING && billingCustomerId) {
          await logUsage(billingCustomerId, {
            type: "agent_messages",
            amount: messageCount,
          })
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