import { HarborError } from '../../errors.js';
import type { ConnectorPlatform } from '../platforms.js';
import { GrokBotConnector } from './connector.js';
import { parseWebhook } from './webhook.js';

// The Grok Bot platform (spec §8 Grok Bot, 2026-11-05): xAI's Grok Bot has no
// API another app can call, but its routines can be woken by a webhook. The
// owner makes a routine with a Webhook trigger in Grok Bot and pastes its
// "POST to" address and key here as the credential; Grok Bot reaches Spaces
// through our MCP server on the agent's own key, as Ando connects it.
//
// There is no check to make with xAI: the only call a routine answers is a
// run, so verify checks the address's shape and the first mention is the test.
// `allowHttp` lets the tests' stand-in listen on loopback; `replyWithinMs` and `watchEveryMs` shorten their waits.

export function grokBotPlatform(options: { allowHttp?: boolean; replyWithinMs?: number; watchEveryMs?: number } = {}): ConnectorPlatform {
  return {
    async verify(secret) {
      const parsed = parseWebhook(secret, options);
      if ('error' in parsed) throw new HarborError('invalid_request', parsed.error);
    },
    start(env) {
      return new GrokBotConnector(env, options).start();
    },
  };
}
