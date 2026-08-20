// Feature flags, published by the preload from the main process environment
// (see @x/shared flags.ts for the why). Read once at module load — flags are
// fixed for the app's lifetime. The optional chain covers test environments
// where no preload ran; there, every flag is off.

export const SPACES_ENABLED: boolean = window.featureFlags?.spaces === true;
