import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { WorkDir } from "../dist/config/config.js";
import { FSModelConfigRepo } from "../dist/models/repo.js";
import { FSMcpConfigRepo } from "../dist/mcp/repo.js";
import { FSAgentsRepo } from "../dist/agents/repo.js";
import { FSRunsRepo } from "../dist/runs/repo.js";

test("uses ROWBOAT_WORKDIR override and eagerly creates expected directories", async () => {
  assert.equal(WorkDir, process.env.ROWBOAT_WORKDIR);

  for (const dirName of ["agents", "config", "runs"]) {
    const stats = await fs.stat(path.join(WorkDir, dirName));
    assert.equal(stats.isDirectory(), true);
  }
});

test("FSModelConfigRepo returns defaults on a fresh workspace", async () => {
  const repo = new FSModelConfigRepo();
  const config = await repo.getConfig();

  assert.equal(config.defaults.provider, "openai");
  assert.equal(config.defaults.model, "gpt-5.1");
  assert.equal(config.providers.openai?.flavor, "openai");
});

test("FSMcpConfigRepo returns an empty config on a fresh workspace", async () => {
  const repo = new FSMcpConfigRepo();
  const config = await repo.getConfig();

  assert.deepEqual(config, { mcpServers: {} });
});

test("FSAgentsRepo can create and read nested agent files", async () => {
  const repo = new FSAgentsRepo();
  await repo.create({
    name: "team/copilot",
    description: "Team helper",
    provider: "openai",
    model: "gpt-5.1",
    instructions: "Be helpful.",
  });

  const fetched = await repo.fetch("team/copilot");
  assert.equal(fetched.name, "team/copilot");
  assert.equal(fetched.description, "Team helper");
  assert.equal(fetched.instructions, "Be helpful.");
});

test("FSRunsRepo creates, fetches, and lists runs", async () => {
  let nextId = 0;
  const repo = new FSRunsRepo({
    idGenerator: {
      next: async () => `run-${++nextId}`,
    },
  });

  const first = await repo.create({ agentId: "copilot" });
  await repo.appendEvents(first.id, [{
    type: "message",
    runId: first.id,
    subflow: [],
    messageId: "msg-1",
    message: {
      role: "user",
      content: "hello",
    },
  }]);

  const second = await repo.create({ agentId: "planner" });

  const fetched = await repo.fetch(first.id);
  assert.equal(fetched.id, first.id);
  assert.equal(fetched.agentId, "copilot");
  assert.equal(fetched.log.length, 2);
  assert.equal(fetched.log[1].type, "message");

  const listed = await repo.list();
  assert.deepEqual(listed.runs.map((run) => run.id), [second.id, first.id]);
});
