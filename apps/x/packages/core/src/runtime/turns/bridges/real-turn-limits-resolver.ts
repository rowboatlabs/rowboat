import { resolveMaxModelCalls } from "../../../config/turn_limits.js";
import type { ITurnLimitsResolver } from "../turn-limits-resolver.js";

// Settings-backed limits resolver: reads config/turn_limits.json on every
// resolve so a settings change applies to the next created turn without a
// restart. Turns that already exist keep the limit persisted in their
// turn_created event.
export class RealTurnLimitsResolver implements ITurnLimitsResolver {
    resolve(context: { humanAvailable: boolean }): number {
        return resolveMaxModelCalls(context);
    }
}
