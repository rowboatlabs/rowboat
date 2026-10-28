import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PgStore, pgliteDb, startHarbor, type RunningHarbor } from '@rowboat/harbor';
import { SpacesClient } from '@x/spaces-client';
import type { Invocation } from '@rowboat/spaces-protocol';
import type { RunPromptArgs } from '../code-mode/acp/manager.js';

// Local agents (Harbor spec §4 Agent members, 2026-10-28) against the REAL
// stub Harbor: this module is the agent's connector, so these drive it the
// way a person does (a mention in a thread) and check what lands in the
// thread. The engine is a stand-in for code mode's: it records the prompt
// and plays back a turn.

// Hoisted with the mocks: they run before the imports below.
const h = await vi.hoisted(async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  return {
    workDir: fs.mkdtempSync(path.join(os.tmpdir(), 'local-agents-')),
    harborUrl: '',
    gagan: undefined as unknown,
    /** The stand-in engine: what the next turn does, and every prompt it was given. */
    prompts: [] as unknown[],
    turn: undefined as unknown as (args: unknown) => Promise<{ stopReason: string; sessionId: string }>,
  };
});
vi.mock('../config/config.js', () => ({ WorkDir: h.workDir }));
vi.mock('./orgs.js', () => ({
  getOrg: (orgId: string) => (orgId === 'org-1' ? { id: 'org-1', baseUrl: h.harborUrl, address: 'localhost' } : undefined),
  getClient: () => h.gagan,
}));
vi.mock('../di/lazy-resolve.js', () => ({
  lazyResolve: async (token: string) => {
    if (token !== 'codeModeManager') throw new Error(`unexpected ${token}`);
    return {
      runPrompt: (args: unknown) => {
        h.prompts.push(args);
        return h.turn(args);
      },
    };
  },
}));
const workDir = h.workDir;
const prompts = h.prompts as RunPromptArgs[];
let harbor: RunningHarbor;
let gagan: SpacesClient;
const setTurn = (fn: (args: RunPromptArgs) => Promise<{ stopReason: string; sessionId: string }>) => {
  h.turn = fn as typeof h.turn;
};

import { ReplyCollector, activityOf, addLocalAgent, decisionFor, forgetLocalAgent, listLocalAgents, stopLocalAgents, updateLocalAgent } from './local-agents.js';

let spaceId: string;
let agentId: string;

async function startTestHarbor(): Promise<RunningHarbor> {
  const db = await pgliteDb();
  const store = new PgStore(db);
  await store.init();
  const started = await startHarbor({ store, orgName: 'Local Test Org', seedMembers: [{ id: 'gagan', displayName: 'Gagan' }, { id: 'harsh', displayName: 'Harsh' }] });
  return { ...started, close: async () => (await started.close(), await db.close()) };
}

const until = async (check: () => Promise<boolean> | boolean, label: string) => {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const invocationsIn = (threadRootId: string) => gagan.listInvocations(spaceId, threadRootId);
const settled = async (threadRootId: string, state: Invocation['state']) =>
  until(async () => (await invocationsIn(threadRootId)).some((i) => i.state === state), `an invocation ${state}`);
const mention = (text: string) => `[@Gagan's Claude Code](#member:${agentId}) ${text}`;

beforeAll(async () => {
  harbor = await startTestHarbor();
  gagan = new SpacesClient({ baseUrl: harbor.url, token: 'dev-gagan' });
  h.harborUrl = harbor.url;
  h.gagan = gagan;
  spaceId = (await gagan.createSpace('Payments')).id;
  await gagan.addMembers(spaceId, ['harsh']);
  setTurn(async (args) => {
    args.onEvent({ type: 'message', role: 'agent', text: 'Let me look.' });
    args.onEvent({ type: 'tool_call', id: 't1', title: 'Read payments.ts', kind: 'read' });
    args.onEvent({ type: 'message', role: 'agent', text: 'The retry is missing.' });
    return { stopReason: 'end_turn', sessionId: 's1' };
  });
  const { agent } = await addLocalAgent({ orgId: 'org-1', displayName: "Gagan's Claude Code", kind: 'claude-code', cwd: workDir, policy: 'yolo' });
  agentId = agent.id;
  await gagan.addMembers(spaceId, [agentId]);
  await until(() => listLocalAgents()[0]?.status === 'online', 'the agent online');
});

afterAll(async () => {
  stopLocalAgents();
  await harbor.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  prompts.length = 0;
});

describe('adding one', () => {
  it('makes a personal local agent and keeps its key on this computer only', async () => {
    const [listing] = await gagan.listAgents();
    expect(listing!.agent).toMatchObject({ agentKind: 'claude-code', agentConnection: 'local', personal: true, ownerId: 'gagan' });
    const saved = JSON.parse(fs.readFileSync(path.join(workDir, 'config', 'spaces_local_agents.json'), 'utf-8'));
    expect(saved.agents[0]).toMatchObject({ orgId: 'org-1', agentId, kind: 'claude-code', cwd: workDir, policy: 'yolo' });
    expect(saved.agents[0].key).toMatch(/^rbk_/);
    // What the app is shown has no key.
    expect(listLocalAgents()[0]).not.toHaveProperty('key');
    expect((fs.statSync(path.join(workDir, 'config', 'spaces_local_agents.json')).mode & 0o777).toString(8)).toBe('600');
  });

  it('is online on the roster while this computer runs it', async () => {
    expect((await gagan.orgRoster()).online).toEqual([agentId]);
  });
});

describe('a mention', () => {
  it('runs the engine in its folder, as its own session for the thread, and posts what it said last', async () => {
    const { message } = await gagan.postMessage(spaceId, { body: mention('why do payments fail?'), actingMode: 'direct' });
    await settled(message.id, 'done');
    expect(prompts).toHaveLength(1);
    const args = prompts[0]!;
    expect(args).toMatchObject({ agent: 'claude', cwd: workDir, policy: 'yolo', runId: `spaces-local-${agentId}-${message.id}` });
    expect(args.prompt).toContain('why do payments fail?');
    expect(args.prompt).toContain(`[Spaces request ${message.id}]`);
    // The Spaces tools, on the agent's own key.
    expect(args.mcpServers).toEqual([{ type: 'http', name: 'rowboat-spaces', url: `${harbor.url}/mcp`, headers: [{ name: 'Authorization', value: expect.stringMatching(/^Bearer rbk_/) }] }]);
    const thread = await gagan.listThread(spaceId, message.id);
    expect(thread.messages.map((m) => [m.author.memberId, m.body])).toEqual([[agentId, 'The retry is missing.']]);
  });

  it('hears what the thread said since it last spoke', async () => {
    const { message: root } = await gagan.postMessage(spaceId, { body: mention('look at checkout'), actingMode: 'direct' });
    await settled(root.id, 'done');
    // To the people only: a plain reply would follow up with the agent (Harbor #1250).
    await gagan.postMessage(spaceId, { threadRoot: root.id, body: 'it broke after the deploy', actingMode: 'direct', peopleOnly: true });
    await gagan.postMessage(spaceId, { threadRoot: root.id, body: mention('and now?'), actingMode: 'direct' });
    await until(async () => (await invocationsIn(root.id)).filter((i) => i.state === 'done').length === 2, 'the second turn');
    const second = prompts[1]!.prompt;
    expect(second).toContain('and now?');
    expect(second).toContain('it broke after the deploy');
    // Its own earlier reply is not repeated back to it.
    expect(second).not.toContain('The retry is missing.');
  });

  it('reads a changed folder and policy on the next turn', async () => {
    const other = fs.mkdtempSync(path.join(workDir, 'repo-'));
    updateLocalAgent({ orgId: 'org-1', agentId, cwd: other, policy: 'ask' });
    const { message } = await gagan.postMessage(spaceId, { body: mention('hi'), actingMode: 'direct' });
    await settled(message.id, 'done');
    expect(prompts[0]).toMatchObject({ cwd: other, policy: 'ask' });
    updateLocalAgent({ orgId: 'org-1', agentId, cwd: workDir, policy: 'yolo' });
  });

  it('asks its owner in the thread before a tool call, and goes on with the decision', async () => {
    let decision: string | undefined;
    setTurn(async (args) => {
      decision = await args.ask({ toolCallId: 'edit-1', title: 'Edit payments.ts', kind: 'edit', isRead: false });
      args.onEvent({ type: 'message', role: 'agent', text: 'Edited.' });
      return { stopReason: 'end_turn', sessionId: 's1' };
    });
    const { message } = await gagan.postMessage(spaceId, { body: mention('fix it'), actingMode: 'direct' });
    let card: Awaited<ReturnType<typeof gagan.listThread>>['messages'][number] | undefined;
    await until(async () => {
      card = (await gagan.listThread(spaceId, message.id)).messages.find((m) => m.approval);
      return Boolean(card);
    }, 'the approval card');
    expect(card!.approval).toMatchObject({ title: 'Edit payments.ts', choices: ['allow_once', 'allow_session', 'deny'], state: 'open' });
    await settled(message.id, 'waiting');
    await gagan.decideApproval(spaceId, card!.approval!.id, { decision: 'allow_session', actingMode: 'direct' });
    await settled(message.id, 'done');
    expect(decision).toBe('allow_always');
  });

  it('stops when its owner stops it', async () => {
    setTurn((args) =>
      new Promise((resolve) => {
        args.onEvent({ type: 'tool_call', id: 't1', title: 'Running tests', kind: 'execute' });
        args.signal!.addEventListener('abort', () => resolve({ stopReason: 'cancelled', sessionId: 's1' }));
      }),
    );
    const { message } = await gagan.postMessage(spaceId, { body: mention('run the suite'), actingMode: 'direct' });
    // Within two seconds of the last line: it goes out when the gap has passed.
    await until(async () => (await invocationsIn(message.id)).some((i) => i.activity === 'Running tests'), 'the activity line');
    const [running] = await invocationsIn(message.id);
    await gagan.cancelInvocation(running!.id);
    await settled(message.id, 'cancelled');
    expect((await gagan.listThread(spaceId, message.id)).messages).toEqual([]);
  });

  it('says why when the engine fails', async () => {
    setTurn(async () => {
      throw new Error('Claude Code is not enabled: turn it on in Settings → Code Mode');
    });
    const { message } = await gagan.postMessage(spaceId, { body: mention('hello'), actingMode: 'direct' });
    await settled(message.id, 'failed');
    expect((await invocationsIn(message.id))[0]!.error).toMatch(/Settings → Code Mode/);
  });
});

describe('forgetting it', () => {
  it('stops answering here and goes offline', async () => {
    forgetLocalAgent({ orgId: 'org-1', agentId });
    expect(listLocalAgents()).toEqual([]);
    // Harbor waits out its grace before saying offline; the connection itself is gone at once.
    await until(async () => (await gagan.orgRoster()).online !== undefined, 'the roster');
  });
});

describe('the pure parts', () => {
  it('replies with what the agent said after its last tool call, or all of it', () => {
    const r = new ReplyCollector();
    r.add({ type: 'message', role: 'agent', text: 'Looking.' });
    r.add({ type: 'tool_call', id: 'a', title: 'Read x' });
    r.add({ type: 'message', role: 'agent', text: 'Found ' });
    r.add({ type: 'message', role: 'agent', text: 'it.' });
    expect(r.reply()).toBe('Found it.');
    const quiet = new ReplyCollector();
    quiet.add({ type: 'message', role: 'agent', text: 'Done before the edit.' });
    quiet.add({ type: 'tool_call', id: 'b', title: 'Edit y' });
    expect(quiet.reply()).toBe('Done before the edit.');
    // A replayed user turn is not the agent's.
    const replay = new ReplyCollector();
    replay.add({ type: 'message', role: 'user', text: 'old question' });
    expect(replay.reply()).toBe('');
  });

  it('reads the activity from tool calls and the plan', () => {
    expect(activityOf({ type: 'tool_call', id: 'a', title: 'Run npm test' })).toBe('Run npm test');
    expect(activityOf({ type: 'plan', entries: [{ content: 'Read', status: 'completed' }, { content: 'Fix the retry', status: 'in_progress' }] })).toBe('Fix the retry');
    expect(activityOf({ type: 'thought' })).toBeUndefined();
  });

  it('maps a card’s choice onto the engine’s', () => {
    expect(decisionFor('allow_once')).toBe('allow_once');
    expect(decisionFor('allow_session')).toBe('allow_always');
    expect(decisionFor('allow_always')).toBe('allow_always');
    expect(decisionFor('deny')).toBe('reject');
  });
});
