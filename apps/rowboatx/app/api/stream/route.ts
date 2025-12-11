import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CLI_BASE_URL = process.env.CLI_BACKEND_URL || 'http://localhost:3000';

/**
 * GET /api/stream
 * Proxy SSE stream from CLI backend to frontend
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const customReadable = new ReadableStream({
    async start(controller) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let isClosed = false;

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        reader?.cancel();
        try {
          controller.close();
        } catch (e) {
          // Already closed, ignore
        }
      });

      try {
        // Connect to CLI backend SSE stream
        const response = await fetch(`${CLI_BASE_URL}/stream`, {
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
          signal: request.signal, // Forward abort signal
        });

        if (!response.ok) {
          throw new Error(`Failed to connect to backend: ${response.statusText}`);
        }

        reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        // Read and forward stream
        while (!isClosed) {
          const { done, value } = await reader.read();
          
          if (done) {
            break;
          }

          // Only enqueue if controller is still open
          if (!isClosed) {
            try {
              controller.enqueue(value);
            } catch (e) {
              // Controller closed, stop reading
              break;
            }
          }
        }
      } catch (error: any) {
        // Only log non-abort errors
        if (error.name !== 'AbortError') {
          console.error('Stream error:', error);
        }
        
        // Try to send error message if controller is still open
        if (!isClosed) {
          try {
            const errorMessage = `data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`;
            controller.enqueue(encoder.encode(errorMessage));
          } catch (e) {
            // Controller already closed, ignore
          }
        }
      } finally {
        // Clean up
        if (reader) {
          try {
            await reader.cancel();
          } catch (e) {
            // Ignore cancel errors
          }
        }
        
        if (!isClosed) {
          try {
            controller.close();
          } catch (e) {
            // Already closed, ignore
          }
        }
      }
    },
  });

  return new Response(customReadable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

