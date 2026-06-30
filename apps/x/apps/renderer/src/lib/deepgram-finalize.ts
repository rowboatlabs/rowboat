export async function finalizeDeepgramStream(ws: WebSocket | null, timeoutMs = 1800): Promise<void> {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  await new Promise<void>((resolve) => {
    let done = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      resolve();
    };
    timeout = setTimeout(finish, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.is_final || data?.speech_final || data?.type === 'UtteranceEnd') {
          finish();
        }
      } catch {
        // Ignore non-JSON control frames.
      }
    };

    ws.addEventListener('message', onMessage);
    try {
      ws.send(JSON.stringify({ type: 'Finalize' }));
    } catch {
      finish();
    }
  });
}
