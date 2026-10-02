// A cloud instance waking from sleep, or booting a new image, takes from a
// second to a minute or two (Baarali, 02/10/2026). Meanwhile the control
// plane's gateway (`instance_waking`) or the instance's own gate
// (`instance_starting`) answers 503: the request never reached the server,
// so asking again is safe — and is what the person expects, rather than an
// error on screen that stays until the app restarts.

export const STARTING_CODES: readonly string[] = ['instance_waking', 'instance_starting'];

/** How long a call waits for a starting instance, all attempts together. */
export const STARTING_BUDGET_MS = 120_000;

async function startingCode(res: Response): Promise<string | null> {
  if (res.status !== 503) return null;
  const body = (await res.clone().json().catch(() => null)) as { error?: { code?: unknown } } | null;
  const code = body?.error?.code;
  return typeof code === 'string' && STARTING_CODES.includes(code) ? code : null;
}

/**
 * `send` again while the answer says the instance is starting, waiting a
 * little longer each time, until `budgetMs` is spent. The last answer is
 * returned as is: past the budget, the caller shows its error.
 */
export async function fetchWhileStarting(
  send: () => Promise<Response>,
  opts: { budgetMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<Response> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? STARTING_BUDGET_MS);
  let delay = 1000;
  for (;;) {
    const res = await send();
    if (!(await startingCode(res)) || now() + delay > deadline) return res;
    await sleep(delay);
    delay = Math.min(delay * 2, 5000);
  }
}
