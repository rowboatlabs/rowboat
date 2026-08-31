// Opening a URL in the user's browser is a CLIENT capability — after the
// client/server split the server may be headless or remote, so core never
// touches Electron's shell directly. The host injects an opener (Electron
// main: shell.openExternal). This is RFC Q14's reverse-call seam in DI form;
// once the WS capability protocol lands, the standalone server's opener
// forwards to a connected client instead.

export interface IUrlOpener {
  open(url: string): Promise<void> | void;
  /** Bring the client's window back to front after a browser round-trip. */
  focusClient?(): void;
}

let opener: IUrlOpener | null = null;

export function registerUrlOpener(next: IUrlOpener): void {
  opener = next;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!opener) {
    throw new Error(
      'no URL opener registered — interactive sign-in flows need a client that can open a browser',
    );
  }
  await opener.open(url);
}

export function focusClient(): void {
  opener?.focusClient?.();
}
