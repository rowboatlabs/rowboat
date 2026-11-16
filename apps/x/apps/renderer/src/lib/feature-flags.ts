// Feature flags, published by the preload from the main process environment
// (see @x/shared flags.ts for the why). Read once at module load — flags are
// fixed for the app's lifetime. The optional chain covers test environments
// where no preload ran; there, every flag is off.

export const SPACES_ENABLED: boolean = window.featureFlags?.spaces === true;

// The web app (2026-10-09) runs no core beside the page, so what needs the
// person's own machine — their Rowboat agent, scheduled sends, voice
// dictation, the local model picker — is off there. The desktop's preload
// never sets it, so everywhere else it is on.
export const LOCAL_RUNTIME: boolean = window.featureFlags?.localRuntime !== false;
