// 2026-11-27: exercise the shipped gateway and its native process watcher. A scripted model
// makes a model call after process completion observable independently of model choice or credits.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startHarbor } from '../src/server.js';
import { maritimePlatform } from '../src/connectors/maritime/index.js';
import { maritimeProvisioner } from '../src/connectors/maritime/provisioning.js';
import { PLATFORMS } from '../src/connectors/platforms.js';
import { FakeMaritime, GOOD_KEY } from '../test/fake-maritime.js';
import { freshStore, restClient } from '../test/helpers.js';
import type { Message } from '@rowboat/spaces-protocol';

async function until<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await delay(500);
  }
  throw new Error('Timed out waiting for ' + what);
}

const modelTurns: string[] = [];
const ack = 'The watcher is running.';
const model = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  res.setHeader('Content-Type', 'application/json');
  if (!req.url?.endsWith('/chat/completions')) {
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'rowboat-test' }] }));
    return;
  }
  let content = 'OK';
  let arm = false;
  if (body.tools?.some((t: { function?: { name: string } }) => t.function?.name === 'terminal')) {
    const last = body.messages.at(-1);
    if (modelTurns.length === 0) {
      arm = true;
      modelTurns.push('start watcher');
    } else if (last.role === 'tool') {
      content = ack;
      modelTurns.push('acknowledge');
    } else {
      const result = String(last.content).match(/Output:\s*(WATCH_\d+)/);
      content = result?.[1] ?? 'No process result';
      modelTurns.push(content);
    }
  }
  const fn = { name: 'terminal', arguments: JSON.stringify({ command: 'sleep 5 && echo WATCH_$$', background: true, notify: true }) };
  const tool = { type: 'function', id: 'call_watch', function: fn };
  const base = { id: 'chatcmpl-' + randomUUID(), created: Math.floor(Date.now() / 1000), model: body.model };
  const finish = arm ? 'tool_calls' : 'stop';
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    const chunk = (delta: object, reason: string | null) => 'data: ' + JSON.stringify({
      ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: reason }],
    }) + '\n\n';
    res.end(chunk({ role: 'assistant', ...(arm ? { tool_calls: [{ index: 0, ...tool }] } : { content }) }, null) + chunk({}, finish) + 'data: [DONE]\n\n');
  } else {
    res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, ...(arm ? { tool_calls: [tool] } : {}) }, finish_reason: finish }] }));
  }
});

async function main() {
  await new Promise<void>(resolve => model.listen(0, resolve));
  const modelPort = (model.address() as AddressInfo).port;
  const vm = 'rowboat-hermes-test-' + randomUUID();
  const image = process.argv[2] ?? 'rowboat-hermes-managed:local';
  const db = await freshStore();
  const platform = await new FakeMaritime().start();
  platform.simulateAdapters = false;
  PLATFORMS.maritime = maritimePlatform(platform.url);
  process.env.HARBOR_INTEGRATION_KEY = 'a'.repeat(64);
  const provider = maritimeProvisioner({ apiKey: GOOD_KEY, base: platform.url });
  const provision = provider.provision.bind(provider);
  const configure = provider.connectHermes.bind(provider);
  let launched = false;
  provider.provision = async input => {
    const result = await provision(input);
    execFileSync('docker', ['run', '-d', '--name', vm, '--platform', 'linux/amd64', '--add-host', 'host.docker.internal:host-gateway',
      '-e', 'ROWBOAT_MANAGED_HERMES=1', image]);
    launched = true;
    return result;
  };
  provider.connectHermes = async (id, url, key, home) => {
    await configure(id, url, key, home);
    // The provider exports updated secrets into a root-owned bash file while PID 1 is running.
    const vars = Object.fromEntries([...platform.env.get(id)!].map(([k, v]) => [k, v.value]));
    Object.assign(vars, { ROWBOAT_URL: url.replace('localhost', 'host.docker.internal'), ROWBOAT_LLM_PROVIDER: 'rowboat',
      ROWBOAT_LLM_BASE_URL: 'http://host.docker.internal:' + modelPort + '/v1', OPENROUTER_API_KEY: 'local-stub',
      ROWBOAT_LLM_MODEL: 'rowboat-test' });
    const exports = Object.entries(vars).map(([k, v]) => "export " + k + "='" + v.replaceAll("'", "'\\''") + "'").join('\n');
    execFileSync('docker', ['exec', '-i', vm, 'sh', '-c', 'umask 077 && cat > /etc/maritime-env.new && mv /etc/maritime-env.new /etc/maritime-env'], { input: exports });
  };
  const harbor = await startHarbor({ store: db.store, seedMembers: [{ id: 'owner', displayName: 'Owner' }], hosting: { provider, tickMs: 300 } });
  try {
    const api = restClient(harbor, 'dev-owner');
    const made = await api.post('/v1/agents/managed', { displayName: 'Watcher', kind: 'hermes' });
    assert.equal(made.status, 200);
    const agent = made.body.agent;
    assert.equal(agent.agentConnection, 'plugin');
    await until(async () => (await api.get('/v1/agents/' + agent.id + '/hosting')).body.hosting.status === 'ready' ? true : undefined, 'gateway readiness');
    const space = (await api.post('/v1/spaces', { name: 'Watcher check' })).body.space.id;
    await api.post('/v1/spaces/' + space + '/members', { memberIds: [agent.id], actingMode: 'direct' });
    const request = await api.post('/v1/spaces/' + space + '/messages', {
      body: '[@Watcher](#member:' + agent.id + ') Start a watcher and report its result here.', actingMode: 'direct',
    });
    const thread = '/v1/spaces/' + space + '/threads/' + request.body.message.id;
    const replies = await until(async () => {
      const messages: Message[] = (await api.get(thread)).body.messages;
      const replies = messages.filter(m => m.author.memberId === agent.id).map(m => m.body);
      return replies.length >= 2 ? replies : undefined;
    }, 'watcher follow-up in the original thread');
    assert.match(replies[1]!, /^WATCH_\d+$/);
    assert.deepEqual(replies, [ack, replies[1]]);
    assert.deepEqual(modelTurns, ['start watcher', 'acknowledge', replies[1]]);
    const invocations = (await api.get('/v1/spaces/' + space + '/invocations')).body.invocations;
    assert.deepEqual(invocations.map((i: { state: string }) => i.state), ['done']);
    assert.equal(platform.submits().length, 0);
    console.log('Managed Hermes connected, acknowledged, and posted its native watcher result in the same thread.');
  } finally {
    if (launched) execFileSync('docker', ['rm', '-fv', vm], { stdio: 'ignore' });
    await harbor.close();
    await platform.close();
    await db.db.close();
    model.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
