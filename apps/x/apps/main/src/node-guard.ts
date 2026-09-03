// Must stay main.ts's FIRST import — everything below it assumes a real
// Electron main process, and the crash this guards against happens while the
// import graph is still evaluating (e.g. ipc.ts touches `app` at module scope).
//
// When ELECTRON_RUN_AS_NODE leaks into the environment (any shell spawned by
// an Electron host inherits it — Rowboat's own code-mode agents are the common
// case, see core/code-mode/acp/agents.ts), `electron .` boots as plain Node:
// require('electron') then resolves to the npm stub (a path string) and the
// first `app.` access dies with a cryptic TypeError deep in the bundle. Fail
// fast with the actual explanation instead. `process.type` is 'browser' only
// in a real main process; under ELECTRON_RUN_AS_NODE it is undefined (while
// process.versions.electron still reports — don't check that).
const type = (process as { type?: string }).type;
if (type !== 'browser') {
    console.error(
        '[main] fatal: not running inside an Electron main process' +
        (process.env.ELECTRON_RUN_AS_NODE
            ? ' — ELECTRON_RUN_AS_NODE leaked in from the parent shell (an Electron-hosted terminal, e.g. code mode). ' +
              'Launch via `npm run start`/`npm run dev` (which strip it) or unset the variable.'
            : ` (process.type=${JSON.stringify(type)}).`),
    );
    process.exit(1);
}

export {};
