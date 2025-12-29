import { Hono } from 'hono';
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { describeRoute, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import z from 'zod';
import container from './di/container.js';
import { executeTool, listServers, listTools } from "./mcp/mcp.js";
import { ListToolsResponse, McpServerDefinition, McpServerList } from "./mcp/schema.js";
import { IMcpConfigRepo } from './mcp/repo.js';
import { IModelConfigRepo } from './models/repo.js';
import { ModelConfig, Provider } from "./models/models.js";
import { IAgentsRepo } from "./agents/repo.js";
import { Agent } from "./agents/agents.js";
import { AskHumanResponsePayload, authorizePermission, createMessage, createRun, replyToHumanInputRequest, Run, stop, ToolPermissionAuthorizePayload } from './runs/runs.js';
import { IRunsRepo, CreateRunOptions, ListRunsResponse } from './runs/repo.js';
import { IBus } from './application/lib/bus.js';
import { cors } from 'hono/cors';

let id = 0;

const routes = new Hono()
    .post(
        '/runs/:runId/messages/new',
        describeRoute({
            summary: 'Create a new message',
            description: 'Create a new message',
            responses: {
                200: {
                    description: 'Message created',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                messageId: z.string(),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            runId: z.string(),
        })),
        validator('json', z.object({
            message: z.string(),
        })),
        async (c) => {
            const messageId = await createMessage(c.req.valid('param').runId, c.req.valid('json').message);
            return c.json({
                messageId,
            });
        }
    )
    .post(
        '/runs/:runId/permissions/authorize',
        describeRoute({
            summary: 'Authorize permission',
            description: 'Authorize a permission',
            responses: {
                200: {
                    description: 'Permission authorized',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    }
                },
            },
        }),
        validator('param', z.object({
            runId: z.string(),
        })),
        validator('json', ToolPermissionAuthorizePayload),
        async (c) => {
            const response = await authorizePermission(
                c.req.valid('param').runId,
                c.req.valid('json')
            );
            return c.json({
                success: true,
            });
        }
    )
    .post(
        '/runs/:runId/human-input-requests/:requestId/reply',
        describeRoute({
            summary: 'Reply to human input request',
            description: 'Reply to a human input request',
            responses: {
                200: {
                    description: 'Human input request replied',
                },
            },
        }),
        validator('param', z.object({
            runId: z.string(),
        })),
        validator('json', AskHumanResponsePayload),
        async (c) => {
            const response = await replyToHumanInputRequest(
                c.req.valid('param').runId,
                c.req.valid('json')
            );
            return c.json({
                success: true,
            });
        }
    )
    .post(
        '/runs/:runId/stop',
        describeRoute({
            summary: 'Stop run',
            description: 'Stop a run',
            responses: {
                200: {
                    description: 'Run stopped',
                },
            },
        }),
        validator('param', z.object({
            runId: z.string(),
        })),
        async (c) => {
            const response = await stop(c.req.valid('param').runId);
            return c.json({
                success: true,
            });
        }
    )
    .get(
        '/stream',
        describeRoute({
            summary: 'Subscribe to run events',
            description: 'Subscribe to run events',
        }),
        async (c) => {
            return streamSSE(c, async (stream) => {
                const bus = container.resolve<IBus>('bus');

                let id = 0;
                let unsub: (() => void) | null = null;
                let aborted = false;

                stream.onAbort(() => {
                    aborted = true;
                    if (unsub) {
                        unsub();
                    }
                });

                // Subscribe to your bus
                unsub = await bus.subscribe('*', async (event) => {
                    if (aborted) return;

                    await stream.writeSSE({
                        data: JSON.stringify(event),
                        event: "message",
                        id: String(id++),
                    });
                });

                // Keep the function alive until the client disconnects
                while (!aborted) {
                    await stream.sleep(1000); // any interval is fine
                }
            });
        }
    )
    ;

const app = new Hono()
    .use("/*", cors())
    .route("/", routes)
    .get(
        "/openapi.json",
        openAPIRouteHandler(routes, {
            documentation: {
                info: {
                    title: "Hono",
                    version: "1.0.0",
                    description: "RowboatX API",
                },
            },
        }),
    );

// export default app;

serve({
    fetch: app.fetch,
    port: Number(process.env.PORT) || 3000,
});

// GET /skills
// POST /skills/new
// GET /skills/<id>
// PUT /skills/<id>
// DELETE /skills/<id>

// GET /sse
