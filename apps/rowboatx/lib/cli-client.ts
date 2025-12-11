/**
 * Type-safe client for the Rowboat CLI backend
 */

const CLI_BASE_URL = process.env.CLI_BACKEND_URL || 'http://localhost:3000';

export interface Run {
  id: string;
  createdAt: string;
  agentId: string;
  log: RunEvent[];
}

export interface RunEvent {
  type: string;
  [key: string]: any;
}

export interface CreateRunOptions {
  agentId: string;
}

export interface Agent {
  name: string;
  description: string;
  instructions: string;
  tools: Record<string, any>;
}

/**
 * CLI Backend Client
 */
export class CliClient {
  private baseUrl: string;

  constructor(baseUrl: string = CLI_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new run (conversation)
   */
  async createRun(options: CreateRunOptions): Promise<Run> {
    const response = await fetch(`${this.baseUrl}/runs/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new Error(`Failed to create run: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Send a message to an existing run
   */
  async sendMessage(runId: string, message: string): Promise<{ messageId: string }> {
    const response = await fetch(`${this.baseUrl}/runs/${runId}/messages/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a run by ID
   */
  async getRun(runId: string): Promise<Run> {
    const response = await fetch(`${this.baseUrl}/runs/${runId}`);

    if (!response.ok) {
      throw new Error(`Failed to get run: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List all runs
   */
  async listRuns(cursor?: string): Promise<{ runs: Run[]; nextCursor?: string }> {
    const url = new URL(`${this.baseUrl}/runs`);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`Failed to list runs: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get an agent by ID
   */
  async getAgent(agentId: string): Promise<Agent> {
    const response = await fetch(`${this.baseUrl}/agents/${agentId}`);

    if (!response.ok) {
      throw new Error(`Failed to get agent: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * List all agents
   */
  async listAgents(): Promise<Agent[]> {
    const response = await fetch(`${this.baseUrl}/agents`);

    if (!response.ok) {
      throw new Error(`Failed to list agents: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create an SSE connection to receive real-time events
   */
  createEventStream(onEvent: (event: RunEvent) => void, onError?: (error: Error) => void): () => void {
    const eventSource = new EventSource(`${this.baseUrl}/stream`);

    eventSource.addEventListener('message', (e) => {
      try {
        const event = JSON.parse(e.data) as RunEvent;
        onEvent(event);
      } catch (error) {
        console.error('Failed to parse event:', error);
        onError?.(error as Error);
      }
    });

    eventSource.addEventListener('error', (e) => {
      console.error('SSE error:', e);
      onError?.(new Error('SSE connection error'));
    });

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  }
}

// Singleton instance
export const cliClient = new CliClient();

