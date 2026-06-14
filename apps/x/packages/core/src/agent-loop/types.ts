// The turn contract + pure derivations now live in @x/shared so the IPC layer
// and the renderer can share them (like runs.ts for the old runtime). This
// re-export keeps the many `./types.js` / `../agent-loop/types.js` imports
// across core working unchanged.
export * from "@x/shared/dist/agent-turn.js";
