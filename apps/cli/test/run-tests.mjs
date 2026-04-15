import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const tempRoot = await mkdtemp(path.join(tmpdir(), "rowboat-cli-test-"));
const testWorkDir = path.join(tempRoot, "workspace");

try {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", "./test/repos.test.mjs", "./test/server.test.mjs"], {
      cwd: packageDir,
      stdio: "inherit",
      env: {
        ...process.env,
        ROWBOAT_WORKDIR: testWorkDir,
      },
    });

    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });

  process.exitCode = Number(exitCode);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
