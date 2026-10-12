import { z } from 'zod';
import { IntegrationError } from '../commands.js';

const REQUIRED_SCOPES = ['object_configuration:read', 'record_permission:read'] as const;
const identitySchema = z.object({ active: z.boolean(), scope: z.string().optional() });
const recordsSchema = z.object({ data: z.array(z.unknown()) });

class AttioError extends IntegrationError {
  // A resource denial does not invalidate the token (spec §8 Attio, 2026-10-12).
  override get rejectsKey(): boolean {
    return this.status === 401;
  }
}

export class AttioApi {
  private readonly key: string;

  constructor(secret: string, private readonly baseUrl = 'https://api.attio.com') {
    this.key = secret.trim();
    if (!this.key) throw new AttioError('Enter an Attio workspace API key.');
  }

  async check(): Promise<void> {
    const identity = identitySchema.safeParse(await this.request('/v2/self'));
    if (!identity.success) throw new AttioError('Attio returned an unexpected identity response.');
    if (!identity.data.active) throw new AttioError('This key is inactive or revoked.', 401);

    if (identity.data.scope !== undefined) {
      const scopes = new Set(identity.data.scope.split(/\s+/));
      const missing = REQUIRED_SCOPES.filter((scope) => !scopes.has(scope) && !scopes.has(`${scope}-write`));
      if (missing.length) throw new AttioError(`Give this key these read scopes: ${missing.join(', ')}.`);
      return;
    }

    // Only active is guaranteed by /self; prove read access when scope is omitted
    // instead of rejecting a valid token or trusting it blindly (spec §8 Attio, 2026-10-12).
    const records = recordsSchema.safeParse(await this.request('/v2/objects/companies/records/query', { limit: 1 }));
    if (!records.success) throw new AttioError('Attio returned an unexpected records response.');
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
        redirect: 'error',
      });
    } catch {
      throw new AttioError('Could not reach Attio. Try again.');
    }

    // API error bodies can echo submitted secrets; use local messages for setup
    // errors, which are returned to the app (spec §8 Attio, 2026-10-12).
    if (response.status === 401) throw new AttioError('This key is inactive or revoked.', 401);
    if (response.status === 403) throw new AttioError(`Access denied. Check ${REQUIRED_SCOPES.join(' and ')} and workspace access.`, 403);
    if (response.status === 429) throw new AttioError('Attio is rate limiting requests. Try again shortly.', 429);
    if (!response.ok) throw new AttioError(`Attio could not verify access (HTTP ${response.status}). Try again.`, response.status);
    try {
      return await response.json();
    } catch {
      throw new AttioError('Attio returned an invalid JSON response.');
    }
  }
}
