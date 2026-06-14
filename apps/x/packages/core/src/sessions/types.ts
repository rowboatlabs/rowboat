// Session contracts now live in @x/shared so the IPC layer and renderer share
// them. This re-export keeps core's `./types.js` imports working unchanged.
export * from "@x/shared/dist/sessions.js";
