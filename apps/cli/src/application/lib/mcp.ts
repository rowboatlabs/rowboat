import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export async function getMcpClient(serverUrl: string, serverName: string): Promise<Client> {
    let client: Client | undefined = undefined;
    const baseUrl = new URL(serverUrl);

    // Try to connect using Streamable HTTP transport
    try {
        client = new Client({
            name: 'streamable-http-client',
            version: '1.0.0'
        });
        const transport = new StreamableHTTPClientTransport(baseUrl);
        await client.connect(transport);
        console.log(`[MCP] Connected using Streamable HTTP transport to ${serverName}`);
        return client;
    } catch (error) {
        // If that fails with a 4xx error, try the older SSE transport
        console.log(`[MCP] Streamable HTTP connection failed, falling back to SSE transport for ${serverName}`);
        client = new Client({
            name: 'sse-client',
            version: '1.0.0'
        });
        const sseTransport = new SSEClientTransport(baseUrl);
        await client.connect(sseTransport);
        console.log(`[MCP] Connected using SSE transport to ${serverName}`);
        return client;
    }
}
