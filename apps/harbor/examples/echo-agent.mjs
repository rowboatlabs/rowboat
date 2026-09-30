// The smallest connector for the agent contract (SPEC.md §8, Invoking agent
// members; the wire in CONTRACT.md, "Agent invocations"). It runs as one
// agent member, on that agent's key: told live when it's mentioned, it also
// lists its pending invocations on start and every minute (the live frame is
// the fast path, the list the guarantee), acknowledges each one, reports
// progress, replies in the thread through the ordinary messages route, and
// reports done. It declares Stop and honors invocation_stop. "slow" in a
// message makes it take 15 seconds, so a second mention in the same thread
// visibly waits its turn. A real connector (Hermes, OpenClaw) keeps this
// shape and swaps the echo for its agent.
//
// Try it against a dev Harbor: add an agent under Agents in the app, add it
// to a space, then
//
//   node apps/harbor/examples/echo-agent.mjs http://localhost:4272 rbk_...

const [, , base, key] = process.argv;
if (!base || !key) {
  console.error('usage: node apps/harbor/examples/echo-agent.mjs <harbor-url> <agent-key>');
  process.exit(1);
}

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plain = (body) => body.replace(/\[@([^\]]+)\]\(#member:[^)]+\)/g, '@$1');

const me = (await api('GET', '/v1/me')).member;
console.log(`echo agent running as ${me.displayName} (${me.id})`);
await api('POST', '/v1/agent/capabilities', { stop: true });

const seen = new Set();
const stopping = new Set();

async function handle(invocation) {
  if (seen.has(invocation.id) || invocation.state !== 'pending') return;
  seen.add(invocation.id);
  const { spaceId, threadRootId } = invocation.conversation;
  const text = plain(invocation.trigger.body);
  console.log(`→ invoked by ${invocation.trigger.authorId}: ${text}`);
  try {
    await api('POST', `/v1/agent/invocations/${invocation.id}/ack`);
    const slow = /\bslow\b/i.test(text);
    await api('POST', `/v1/agent/invocations/${invocation.id}/update`, { state: 'working', activity: slow ? 'Taking my time' : 'Thinking it over' });
    for (let waited = 0; waited < (slow ? 15_000 : 1_500); waited += 500) {
      if (stopping.has(invocation.id)) {
        await api('POST', `/v1/agent/invocations/${invocation.id}/update`, { state: 'cancelled' });
        console.log('  stopped');
        return;
      }
      await sleep(500);
    }
    await api('POST', `/v1/spaces/${spaceId}/messages`, { threadRoot: threadRootId, body: `Echo: ${text}`, actingMode: 'direct' });
    await api('POST', `/v1/agent/invocations/${invocation.id}/update`, { state: 'done' });
    console.log('  replied, done');
  } catch (err) {
    console.error('  failed:', err.message);
    await api('POST', `/v1/agent/invocations/${invocation.id}/update`, { state: 'failed', error: err.message }).catch(() => {});
  }
}

// The list is the guarantee: on start, and every minute.
async function sweep() {
  const { invocations } = await api('GET', '/v1/agent/invocations');
  for (const invocation of invocations) void handle(invocation);
}

// The live frame is the fast path.
function connect() {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/v1/live?token=${encodeURIComponent(key)}`);
  ws.onmessage = (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.kind === 'invocation') void handle(frame.invocation);
    if (frame.kind === 'invocation_stop') stopping.add(frame.invocationId);
  };
  ws.onopen = () => void sweep();
  ws.onclose = () => setTimeout(connect, 2000);
}
connect();
setInterval(() => void sweep().catch((err) => console.error('sweep failed:', err.message)), 60_000);
