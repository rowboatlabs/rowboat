import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { closeAuthServer, createAuthServer } from './auth-server.js';

test('closeAuthServer releases a fixed callback port before the next flow binds', async () => {
  const first = await createAuthServer(0, () => {});
  const port = (first.server.address() as AddressInfo).port;

  await closeAuthServer(first.server);

  const second = await createAuthServer(port, () => {});
  assert.equal((second.server.address() as AddressInfo).port, port);
  await closeAuthServer(second.server);

  // Cleanup is deliberately safe when a callback and cancellation race.
  await closeAuthServer(second.server);
});
