import { cliClient, RunEvent } from '@/lib/cli-client';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/chat
 * Creates a new conversation or sends a message to existing one
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, runId } = body;

    if (!message || typeof message !== 'string') {
      return Response.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    let currentRunId = runId;

    // Create new run if no runId provided
    if (!currentRunId) {
      const run = await cliClient.createRun({
        agentId: 'copilot',
      });
      currentRunId = run.id;
    }
    
    // Always send the message (this triggers the agent runtime)
    await cliClient.sendMessage(currentRunId, message);

    // Return the run ID
    return Response.json({ runId: currentRunId });
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json(
      { error: 'Failed to process message' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat?runId=xxx
 * Get a specific run's details
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const runId = searchParams.get('runId');

    if (!runId) {
      // List all runs
      const result = await cliClient.listRuns();
      return Response.json(result);
    }

    // Get specific run
    const run = await cliClient.getRun(runId);
    return Response.json(run);
  } catch (error) {
    console.error('Chat API error:', error);
    return Response.json(
      { error: 'Failed to fetch run' },
      { status: 500 }
    );
  }
}
