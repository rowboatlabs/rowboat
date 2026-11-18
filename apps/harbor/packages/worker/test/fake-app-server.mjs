// A stand-in for `codex app-server` on stdio: the JSON-RPC lines a turn
// produces, scripted by the prompt. "wait" holds the turn until it is steered
// or interrupted; "fail" ends it failed; "crash" exits the process mid-turn;
// anything else answers "pong" after a moment, with every steered line
// appended. Thread ids start with "thr-"; resuming an unknown one is refused.

let nextThread = 1;
let nextTurn = 1;
const threads = new Map(); // threadId → { active?: { turnId, prompt, steered: [] } }
let buf = '';
const send = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const notify = (method, params) => send({ method, params });

function complete(threadId, status, text) {
  const t = threads.get(threadId);
  if (!t?.active) return;
  const { turnId } = t.active;
  t.active = undefined;
  if (text !== undefined) {
    notify('item/started', { threadId, turnId, item: { type: 'agentMessage', id: `msg-${turnId}`, text: '', phase: 'final_answer' } });
    notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', id: `msg-${turnId}`, text, phase: 'final_answer' }, completedAtMs: Date.now() });
  }
  notify('thread/status/changed', { threadId, status: { type: 'idle' } });
  notify('turn/completed', {
    threadId,
    turn: { id: turnId, rootTurnId: turnId, items: [], itemsView: 'notLoaded', status, error: status === 'failed' ? { message: 'the fake failed as asked', codexErrorInfo: null, additionalDetails: null, misalignment: null } : null, startedAt: null, completedAt: null, durationMs: null },
  });
}

function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => send({ id, result });
  const error = (code, message) => send({ id, error: { code, message } });
  switch (method) {
    case 'initialize':
      return reply({ userAgent: 'fake-app-server/0', codexHome: '/nowhere', platformFamily: 'unix', platformOs: 'test' });
    case 'initialized':
      return;
    case 'model/list':
      return reply({ data: [{ id: 'gpt-fake-fast', model: 'gpt-fake-fast', displayName: 'Fake Fast', hidden: false }, { id: 'gpt-fake-hidden', model: 'gpt-fake-hidden', displayName: 'Hidden', hidden: true }, { id: 'gpt-fake-big', model: 'gpt-fake-big', displayName: 'Fake Big', hidden: false }], nextCursor: null });
    case 'thread/start': {
      const threadId = `thr-${nextThread++}`;
      threads.set(threadId, {});
      notify('thread/started', { thread: { id: threadId } });
      return reply({ thread: { id: threadId }, model: 'gpt-fake-fast', cwd: params?.cwd ?? '/' });
    }
    case 'thread/resume': {
      const threadId = params?.threadId;
      if (typeof threadId !== 'string' || !threadId.startsWith('thr-')) return error(-32600, `no such thread ${threadId}`);
      if (!threads.has(threadId)) threads.set(threadId, {});
      return reply({ thread: { id: threadId }, model: 'gpt-fake-fast', cwd: params?.cwd ?? '/' });
    }
    case 'thread/read':
      return reply({ thread: { id: params?.threadId } });
    case 'turn/start': {
      const threadId = params?.threadId;
      const t = threads.get(threadId);
      if (!t) return error(-32600, `no such thread ${threadId}`);
      if (t.active) return error(-32600, 'a turn is already active');
      const turnId = `turn-${nextTurn++}`;
      const prompt = (params?.input ?? []).map((i) => i.text ?? '').join('\n');
      t.active = { turnId, prompt, steered: [] };
      reply({ turn: { id: turnId, rootTurnId: turnId, items: [], itemsView: 'notLoaded', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null } });
      notify('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
      notify('item/started', { threadId, turnId, item: { type: 'commandExecution', id: `exec-${turnId}`, command: '/bin/sh -c "echo hi"', cwd: '/', status: 'inProgress' } });
      setTimeout(() => {
        notify('item/completed', { threadId, turnId, item: { type: 'commandExecution', id: `exec-${turnId}`, command: '/bin/sh -c "echo hi"', cwd: '/', status: 'completed', exitCode: 0 }, completedAtMs: Date.now() });
        if (/\bcrash\b/.test(prompt)) process.exit(3);
        if (/\bfail\b/.test(prompt)) return complete(threadId, 'failed');
        if (/\bwait\b/.test(prompt)) return;
        complete(threadId, 'completed', ['pong', ...t.active.steered].join(' | '));
      }, 60);
      return;
    }
    case 'turn/steer': {
      const t = threads.get(params?.threadId);
      if (!t?.active) return error(-32600, 'no active turn to steer');
      if (t.active.turnId !== params?.expectedTurnId) return error(-32600, 'expectedTurnId does not match the active turn');
      const text = (params?.input ?? []).map((i) => i.text ?? '').join('\n');
      t.active.steered.push(text);
      reply({ turnId: t.active.turnId });
      // A held turn finishes once steered, so a test sees the steered text in the answer.
      if (/\bwait\b/.test(t.active.prompt) && !/\bkeep waiting\b/.test(text)) setTimeout(() => complete(params.threadId, 'completed', ['pong', ...t.active.steered].join(' | ')), 60);
      return;
    }
    case 'turn/interrupt': {
      const t = threads.get(params?.threadId);
      if (!t?.active || t.active.turnId !== params?.turnId) return reply({});
      reply({});
      complete(params.threadId, 'interrupted');
      return;
    }
    default:
      return error(-32601, `method not found: ${method}`);
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let at;
  while ((at = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (!line.trim()) continue;
    handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
