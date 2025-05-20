import { logUsage } from "@/app/lib/billing";
import { USE_BILLING } from "@/app/lib/feature_flags";
import { projectsCollection, usersCollection } from "@/app/lib/mongodb";
import { redisClient } from "@/app/lib/redis";
import { CopilotAPIRequest } from "@/app/lib/types/copilot_types";
import { ObjectId } from "mongodb";

export async function GET(request: Request, { params }: { params: { streamId: string } }) {
  // get the payload from redis
  const payload = await redisClient.get(`copilot-stream-${params.streamId}`);
  if (!payload) {
    return new Response("Stream not found", { status: 404 });
  }

  // parse the payload
  const parsedPayload = CopilotAPIRequest.parse(JSON.parse(payload));

  // fetch project from db
  const project = await projectsCollection.findOne({
    _id: parsedPayload.projectId,
  });
  if (!project) {
    return new Response("Project not found", { status: 404 });
  }

  // fetch project user from db
  const user = await usersCollection.findOne({
    auth0Id: project.createdByUserId,
  });
  if (!user) {
    return new Response("User not found", { status: 404 });
  }

  // ensure user has billing customer id
  if (USE_BILLING && !user.billingCustomerId) {
    return new Response("User has no billing customer id", { status: 404 });
  }

  // Fetch the upstream SSE stream.
  const upstreamResponse = await fetch(`${process.env.COPILOT_API_URL}/chat_stream`, {
    method: 'POST',
    body: payload,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.COPILOT_API_KEY || 'test'}`,
    },
    cache: 'no-store',
  });

  // If the upstream request fails, return a 502 Bad Gateway.
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response("Error connecting to upstream SSE stream", { status: 502 });
  }

  const reader = upstreamResponse.body.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Read from the upstream stream continuously.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          // Immediately enqueue each received chunk.
          controller.enqueue(value);
        }
        controller.close();

        // increment copilot request count in billing
        if (USE_BILLING && user.billingCustomerId) {
          try {
            await logUsage(user.billingCustomerId, {
              type: "copilot_requests",
              amount: 1,
            });
          } catch (error) {
            console.error("Error logging usage", error);
          }
        }
      } catch (error) {
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