// Feature flags. Build-time via EXPO_PUBLIC_* env (inlined by Expo).
//
// legacyChatBrain: the pre-Spaces app — paired chat home, drawer history,
// Brain. ON by default while Spaces v1 is built; the release build sets
// EXPO_PUBLIC_LEGACY_CHAT=0 and ships Spaces-only. Flip the default here
// once S3 lands (see MOBILE_PLAN.md).
export const FLAGS = {
  legacyChatBrain: process.env.EXPO_PUBLIC_LEGACY_CHAT !== '0',
} as const;
