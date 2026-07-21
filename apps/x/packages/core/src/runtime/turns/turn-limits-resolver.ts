// Resolves the effective model-call limit for a new turn when the caller
// didn't pass an explicit maxModelCalls. The execution context is the
// humanAvailable flag: true for interactive chat turns, false for
// headless/autonomous work. The real bridge reads the user's settings;
// tests construct TurnRuntime without one and get the built-in default.
export interface ITurnLimitsResolver {
    resolve(context: { humanAvailable: boolean }): number;
}
