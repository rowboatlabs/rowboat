import type { ConnectorEnv, RunningConnector } from '../platforms.js';
import { MaritimeError, type MaritimeApi } from './api.js';

// 2026-11-27: a managed plugin consumes its own invocations. Harbor can start the machine
// even when no gateway is connected. It never acknowledges a turn or starts a CLI for it.
export function wakeForPlugin(env: ConnectorEnv, api: () => Promise<MaritimeApi>): RunningConnector {
  let stopped = false;
  let pending: Promise<void> | undefined;
  const check = async () => {
    const work = (await env.service.listAgentInvocations(env.ctx)).filter(i => i.state === 'pending');
    if (stopped || !work.length) return;
    const online = env.service.agentConnected(env.agent.id);
    const refusal = online ? undefined : await env.service.adapterTurnRefusal(env.agent.id);
    if (refusal) {
      for (const i of work) await env.service.failPendingInvocation(env.ctx, i.id, refusal);
      return;
    }
    await env.service.ensureHermesConnection(env.agent.id);
    if (stopped || env.service.agentConnected(env.agent.id)) return;
    try {
      await (await api()).start(env.agent.agentInstance!);
    } catch (err) {
      if (!(err instanceof MaritimeError)) throw err;
      if (err.alreadyRunning) return;
      for (const invocation of work) {
        const expired = Date.now() - Date.parse(invocation.updatedAt) > 10 * 60_000;
        if (err.gone || err.rejectsKey || expired) {
          await env.service.failPendingInvocation(env.ctx, invocation.id, ('Maritime could not start this agent: ' + err.message).slice(0, 1000));
        }
      }
      if (!err.mustWait) throw err;
    }
  };
  const wake = () => {
    pending ??= check().catch(e => env.log('could not wake the Hermes gateway', { error: (e as Error).message }))
      .finally(() => { pending = undefined; });
  };
  const unsubscribe = env.subscribe(frame => {
    if (frame.kind === 'invocation' && frame.invocation.state === 'pending') wake();
  });
  const timer = setInterval(wake, 60_000);
  wake();
  return {
    async stop() {
      stopped = true;
      unsubscribe();
      clearInterval(timer);
      await pending;
    },
  };
}
