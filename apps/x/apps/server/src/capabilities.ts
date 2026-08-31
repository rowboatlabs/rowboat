// Reverse calls (RFC Q14): core sometimes needs the CLIENT to do something —
// show an OS notification, open a browser, drive the embedded browser pane.
// Clients declare capabilities in their WS hello; the broker routes each
// request to one capable client and awaits its reply over the socket.
//
// The standalone server registers core's DI seams (notification service,
// url-opener, browser-control) with implementations that call this broker.
// With no capable client connected, requests fail loudly — by design.

export interface CapabilityRequestOptions {
  timeoutMs?: number;
}

export interface CapabilityTransport {
  /** Send a request to one client advertising `capability`; resolves with its reply. */
  request(capability: string, payload: unknown, opts?: CapabilityRequestOptions): Promise<unknown>;
  /** Fire-and-forget to EVERY client advertising `capability` (e.g. notifications). */
  broadcast(capability: string, payload: unknown): void;
  hasCapableClient(capability: string): boolean;
}

let transport: CapabilityTransport | null = null;

export function setCapabilityTransport(next: CapabilityTransport): void {
  transport = next;
}

export function capabilityBroker(): CapabilityTransport {
  return {
    request(capability, payload, opts) {
      if (!transport) {
        return Promise.reject(new Error(`no client connected that provides '${capability}'`));
      }
      return transport.request(capability, payload, opts);
    },
    broadcast(capability, payload) {
      transport?.broadcast(capability, payload);
    },
    hasCapableClient(capability) {
      return transport?.hasCapableClient(capability) ?? false;
    },
  };
}
