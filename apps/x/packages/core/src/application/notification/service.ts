export interface NotifyInput {
    title?: string;
    message: string;
    link?: string;
    actionLabel?: string;
    secondaryActions?: Array<{ label: string; link: string }>;
    /**
     * When true, the notification is suppressed if the app is currently in the
     * foreground (any window focused). Use for ambient notifications the user
     * doesn't need while actively looking at the app (e.g. chat completion, new
     * email). Leave unset/false for notifications that must always surface
     * regardless of focus (e.g. an agent permission request that blocks a run).
     */
    onlyWhenBackground?: boolean;
    /**
     * When true, the notification is suppressed if it fires within the startup
     * grace window (see STARTUP_GRACE_MS). This exists for notifications that a
     * just-launched app can emit in a burst — most notably background-task
     * completions: when the app reopens after being closed, every task that was
     * queued while it was down completes at once and would otherwise flood the
     * user. Fresh, user-driven activity happens after the window closes.
     */
    suppressDuringStartupGrace?: boolean;
}

export interface INotificationService {
    isSupported(): boolean;
    notify(input: NotifyInput): void;
}

/**
 * How long after launch grace-eligible notifications stay suppressed. Long
 * enough to swallow the reopen burst of queued background tasks, short enough
 * that a task genuinely finishing right after launch still pings the user.
 */
export const STARTUP_GRACE_MS = 60_000;

/**
 * Pure decision for the startup grace gate, kept out of the Electron service so
 * it can be unit-tested without an Electron runtime. Returns true when the
 * notification should be dropped because it is grace-eligible and we are still
 * inside the window measured from `launchedAt`.
 */
export function shouldSuppressDuringStartupGrace(
    input: Pick<NotifyInput, "suppressDuringStartupGrace">,
    launchedAt: number,
    now: number = Date.now(),
    graceWindowMs: number = STARTUP_GRACE_MS,
): boolean {
    return Boolean(input.suppressDuringStartupGrace) && now - launchedAt < graceWindowMs;
}
