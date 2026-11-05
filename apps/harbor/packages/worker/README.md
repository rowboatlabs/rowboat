# @rowboat/worker

The worker that runs beside an agent's harness and carries Harbor's invocations to it (SPEC.md §8 Connectors, *the agent worker*; the plan is `plans/agent-worker-v1.md` in Main). It is a client of the agent contract on the agent's own key, like the echo example and the Hermes plugin: told live when the agent is invoked, listing every minute, acknowledging, running each conversation's turns one after another through the harness, reporting what it does, posting the answer, reporting done. It declares Stop, and steering when the harness can take input mid-turn. Codex is the first harness, through `codex app-server`.

```
rowboat-worker --url https://org.example --cwd /data/workspace --state /data/rowboat/worker --idle 600
```

The key comes from `ROWBOAT_AGENT_KEY` or `--key-file`; the worker never writes it anywhere. `--idle` makes it exit after that many seconds with nothing to do, so a Maritime box can sleep; without it, it runs until stopped. `--sandbox` is `danger-full-access` unless told otherwise: the machine is the sandbox, as it was for the exec-driven turn.

`pnpm build` writes the library to `dist/` and one file for the machine the worker runs on, `dist/rowboat-worker.cjs` (Node 20 or later, nothing to install beside it). `pnpm test` runs the worker against the real stub Harbor on Postgres in-process, and the Codex adapter against a stand-in app-server (`test/fake-app-server.mjs`).
