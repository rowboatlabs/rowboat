import { Hono } from 'hono';
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { describeRoute, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import z from 'zod';
import container from './di/container.js';
import { AskHumanResponsePayload, authorizePermission, createMessage, createRun, replyToHumanInputRequest, Run, stop, ToolPermissionAuthorizePayload } from './runs/runs.js';
import { IBus } from './application/lib/bus.js';
import { cors } from 'hono/cors';
import { pathToFileURL } from 'node:url';

export interface ServerDependencies {
    createMessage(runId: string, message: string): Promise<string>;
    authorizePermission(runId: string, payload: z.infer<typeof ToolPermissionAuthorizePayload>): Promise<void>;
    replyToHumanInputRequest(runId: string, payload: z.infer<typeof AskHumanResponsePayload>): Promise<void>;
    stop(runId: string): Promise<void>;
    subscribeToEvents(listener: (event: unknown) => Promise<void>): Promise<() => void>;
}

const defaultDependencies: ServerDependencies = {
    createMessage,
    authorizePermission,
    replyToHumanInputRequest,
    stop,
    subscribeToEvents: async (listener) => {
        const bus = container.resolve<IBus>('bus');
        return bus.subscribe('*', listener);
    },
};

export function createApp(deps: ServerDependencies = defaultDependencies): Hono {
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
                const messageId = await deps.createMessage(c.req.valid('param').runId, c.req.valid('json').message);
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
                await deps.authorizePermission(
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
                await deps.replyToHumanInputRequest(
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
                await deps.stop(c.req.valid('param').runId);
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
                    let eventId = 0;
                    let unsub: (() => void) | null = null;
                    let aborted = false;

                    stream.onAbort(() => {
                        aborted = true;
                        if (unsub) {
                            unsub();
                        }
                    });

                    unsub = await deps.subscribeToEvents(async (event) => {
                        if (aborted) return;

                        await stream.writeSSE({
                            data: JSON.stringify(event),
                            event: "message",
                            id: String(eventId++),
                        });
                    });

                    while (!aborted) {
                        await stream.sleep(1000);
                    }
                });
            }
        );

    return new Hono()
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
}

export const app = createApp();

export function startServer(port: number = Number(process.env.PORT) || 3000): void {
    serve({
        fetch: app.fetch,
        port,
    });
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
    startServer();
}

// GET /skills
// POST /skills/new
// GET /skills/<id>
// PUT /skills/<id>
// DELETE /skills/<id>

// GET /sse
