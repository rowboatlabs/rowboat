import { Hono } from 'hono';
import { serve } from '@hono/node-server'
import { streamSSE } from 'hono/streaming'
import { describeRoute, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import z from 'zod';
import container from './di/container.js';
import { executeTool, listServers, listTools, ListToolsResponse, McpServerList } from "./mcp/mcp.js";
import { McpServerDefinition } from "./mcp/mcp.js";
import { IMcpConfigRepo } from './mcp/repo.js';
import { IModelConfigRepo } from './models/repo.js';
import { ModelConfig, Provider } from "./models/models.js";
import { IAgentsRepo } from "./agents/repo.js";
import { Agent } from "./agents/agents.js";
import { AskHumanResponsePayload, authorizePermission, createMessage, createRun, replyToHumanInputRequest, Run, stop, ToolPermissionAuthorizePayload } from './runs/runs.js';
import { IRunsRepo, CreateRunOptions, ListRunsResponse } from './runs/repo.js';
import { IBus } from './application/lib/bus.js';

let id = 0;

const routes = new Hono()
    .get(
        '/health',
        describeRoute({
            summary: 'Health check',
            description: 'Check if the server is running',
            responses: {
                200: {
                    description: 'Server is running',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                status: z.literal("ok"),
                            })),
                        },
                    },
                },
            },
        }),
        async (c) => {
            return c.json({ status: 'ok' });
        }
    )
    .get(
        '/mcp',
        describeRoute({
            summary: 'List MCP servers',
            description: 'List the MCP servers',
            responses: {
                200: {
                    description: 'Server list',
                    content: {
                        'application/json': {
                            schema: resolver(McpServerList),
                        },
                    },
                },
            },
        }),
        async (c) => {
            return c.json(await listServers());
        }
    )
    .put(
        '/mcp/:serverName',
        describeRoute({
            summary: 'Upsert MCP server',
            description: 'Add or edit MCP server',
            responses: {
                200: {
                    description: 'MCP server added / updated',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            serverName: z.string(),
        })),
        validator('json', McpServerDefinition),
        async (c) => {
            const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
            await repo.upsert(c.req.valid('param').serverName, c.req.valid('json'));
            return c.json({ success: true });
        }
    )
    .delete(
        '/mcp/:serverName',
        describeRoute({
            summary: 'Delete MCP server',
            description: 'Delete a MCP server',
            responses: {
                200: {
                    description: 'MCP server deleted',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            serverName: z.string(),
        })),
        async (c) => {
            const repo = container.resolve<IMcpConfigRepo>('mcpConfigRepo');
            await repo.delete(c.req.valid('param').serverName);
            return c.json({ success: true });
        }
    )
    .get(
        '/mcp/:serverName/tools',
        describeRoute({
            summary: 'Get MCP tools',
            description: 'Get the MCP tools',
            responses: {
                200: {
                    description: 'MCP tools',
                    content: {
                        'application/json': {
                            schema: resolver(ListToolsResponse),
                        },
                    },
                },
            },
        }),
        validator('query', z.object({
            cursor: z.string().optional(),
        })),
        validator('param', z.object({
            serverName: z.string(),
        })),
        async (c) => {
            const result = await listTools(c.req.valid('param').serverName, c.req.valid('query').cursor);
            return c.json(result);
        }
    )
    .post(
        '/mcp/:serverName/tools/:toolName/execute',
        describeRoute({
            summary: 'Execute MCP tool',
            description: 'Execute a MCP tool',
            responses: {
                200: {
                    description: 'Tool executed',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                result: z.any(),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            serverName: z.string(),
            toolName: z.string(),
        })),
        validator('json', z.object({
            input: z.any(),
        })),
        async (c) => {
            const result = await executeTool(
                c.req.valid('param').serverName,
                c.req.valid('param').toolName,
                c.req.valid('json').input
            );
            return c.json(result);
        }
    )
    .get(
        '/models',
        describeRoute({
            summary: 'Get model config',
            description: 'Get the current model and provider configuration',
            responses: {
                200: {
                    description: 'Model config',
                    content: {
                        'application/json': {
                            schema: resolver(ModelConfig),
                        },
                    },
                },
            },
        }),
        async (c) => {
            const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
            const config = await repo.getConfig();
            return c.json(config);
        }
    )
    .put(
        '/models/providers/:providerName',
        describeRoute({
            summary: 'Upsert provider config',
            description: 'Add or update a provider configuration',
            responses: {
                200: {
                    description: 'Provider upserted',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            providerName: z.string(),
        })),
        validator('json', Provider),
        async (c) => {
            const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
            await repo.upsert(c.req.valid('param').providerName, c.req.valid('json'));
            return c.json({ success: true });
        }
    )
    .delete(
        '/models/providers/:providerName',
        describeRoute({
            summary: 'Delete provider config',
            description: 'Delete a provider configuration',
            responses: {
                200: {
                    description: 'Provider deleted',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            providerName: z.string(),
        })),
        async (c) => {
            const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
            await repo.delete(c.req.valid('param').providerName);
            return c.json({ success: true });
        }
    )
    .put(
        '/models/default',
        describeRoute({
            summary: 'Set default model',
            description: 'Set the default provider and model',
            responses: {
                200: {
                    description: 'Default set',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('json', z.object({
            provider: z.string(),
            model: z.string(),
        })),
        async (c) => {
            const repo = container.resolve<IModelConfigRepo>('modelConfigRepo');
            const body = c.req.valid('json');
            await repo.setDefault(body.provider, body.model);
            return c.json({ success: true });
        }
    )
    // GET /agents
    .get(
        '/agents',
        describeRoute({
            summary: 'List agents',
            description: 'List all configured agents',
            responses: {
                200: {
                    description: 'Agents list',
                    content: {
                        'application/json': {
                            schema: resolver(z.array(Agent)),
                        },
                    },
                },
            },
        }),
        async (c) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            const agents = await repo.list();
            return c.json(agents);
        }
    )
    // POST /agents/new
    .post(
        '/agents/new',
        describeRoute({
            summary: 'Create agent',
            description: 'Create a new agent',
            responses: {
                200: {
                    description: 'Agent created',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('json', Agent),
        async (c) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            await repo.create(c.req.valid('json'));
            return c.json({ success: true });
        }
    )
    // GET /agents/<id>
    .get(
        '/agents/:id',
        describeRoute({
            summary: 'Get agent',
            description: 'Fetch a specific agent by id',
            responses: {
                200: {
                    description: 'Agent',
                    content: {
                        'application/json': {
                            schema: resolver(Agent),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            id: z.string(),
        })),
        async (c) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            const agent = await repo.fetch(c.req.valid('param').id);
            return c.json(agent);
        }
    )
    // PUT /agents/<id>
    .put(
        '/agents/:id',
        describeRoute({
            summary: 'Update agent',
            description: 'Update an existing agent',
            responses: {
                200: {
                    description: 'Agent updated',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            id: z.string(),
        })),
        validator('json', Agent),
        async (c) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            await repo.update(c.req.valid('param').id, c.req.valid('json'));
            return c.json({ success: true });
        }
    )
    // DELETE /agents/<id>
    .delete(
        '/agents/:id',
        describeRoute({
            summary: 'Delete agent',
            description: 'Delete an agent by id',
            responses: {
                200: {
                    description: 'Agent deleted',
                    content: {
                        'application/json': {
                            schema: resolver(z.object({
                                success: z.literal(true),
                            })),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            id: z.string(),
        })),
        async (c) => {
            const repo = container.resolve<IAgentsRepo>('agentsRepo');
            await repo.delete(c.req.valid('param').id);
            return c.json({ success: true });
        }
    )
    .get(
        '/runs/:runId',
        describeRoute({
            summary: 'Get run',
            description: 'Get a run by id',
            responses: {
                200: {
                    description: 'Run',
                    content: {
                        'application/json': {
                            schema: resolver(Run),
                        },
                    },
                },
            },
        }),
        validator('param', z.object({
            runId: z.string(),
        })),
        async (c) => {
            const repo = container.resolve<IRunsRepo>('runsRepo');
            const run = await repo.fetch(c.req.valid('param').runId);
            return c.json(run);
        }
    )
    .post(
        '/runs/new',
        describeRoute({
            summary: 'Create run',
            description: 'Create a new run',
            responses: {
                200: {
                    description: 'Run created',
                    content: {
                        'application/json': {
                            schema: resolver(Run),
                        },
                    },
                },
            },
        }),
        validator('json', CreateRunOptions),
        async (c) => {
            const run = await createRun(c.req.valid('json'));
            return c.json(run);
        }
    )
    .get(
        '/runs',
        describeRoute({
            summary: 'List runs',
            description: 'List all runs',
            responses: {
                200: {
                    description: 'Runs list',
                    content: {
                        'application/json': {
                            schema: resolver(ListRunsResponse),
                        },
                    },
                },
            },
        }),
        validator('query', z.object({
            cursor: z.string().optional(),
        })),
        async (c) => {
            const repo = container.resolve<IRunsRepo>('runsRepo');
            const runs = await repo.list(c.req.valid('query').cursor);
            return c.json(runs);
        }
    )
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

                    console.log('got ev', event);
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