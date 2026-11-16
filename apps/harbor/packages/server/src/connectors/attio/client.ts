import { z } from 'zod';
import { IntegrationError } from '../commands.js';

const REQUIRED_SCOPES = ['object_configuration:read', 'record_permission:read'] as const;
const identitySchema = z.object({ active: z.boolean(), scope: z.string().optional() });
const recordsSchema = z.object({ data: z.array(z.unknown()) });
const textValue = z.object({ value: z.string(), active_until: z.string().nullable().optional() });
const companySchema = z.object({
  id: z.object({ record_id: z.uuid() }),
  web_url: z.string().optional(),
  values: z.object({
    name: z.array(textValue).optional(),
    description: z.array(textValue).optional(),
    domains: z.array(z.object({ domain: z.string(), active_until: z.string().nullable().optional() })).optional(),
  }),
});
export type AttioCompany = z.infer<typeof companySchema>;
const personSchema = z.object({
  id: z.object({ record_id: z.uuid() }),
  web_url: z.string().optional(),
  values: z.object({
    name: z.array(z.object({
      full_name: z.string().nullable().optional(),
      first_name: z.string().nullable().optional(),
      last_name: z.string().nullable().optional(),
      active_until: z.string().nullable().optional(),
    })).optional(),
    email_addresses: z.array(z.object({ email_address: z.string(), active_until: z.string().nullable().optional() })).optional(),
    job_title: z.array(textValue).optional(),
  }),
});
export type AttioPerson = z.infer<typeof personSchema>;
const recordSchema = z.object({
  id: z.object({ record_id: z.uuid() }),
  web_url: z.string().optional(),
  values: z.record(z.string(), z.array(z.unknown())),
});
export type AttioRecord = z.infer<typeof recordSchema>;
export const LOOKUP_LIMIT = 10;

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

  async companies(domain: string): Promise<AttioCompany[]> {
    const result = z.object({ data: z.array(companySchema) }).safeParse(await this.request('/v2/objects/companies/records/query', {
      filter: { domains: { domain: { $eq: domain } } },
      limit: LOOKUP_LIMIT + 1,
      offset: 0,
    }));
    if (!result.success) throw new AttioError('Attio returned an unexpected company response.');
    return result.data.data;
  }

  async people(email: string): Promise<AttioPerson[]> {
    const result = z.object({ data: z.array(personSchema) }).safeParse(await this.request('/v2/objects/people/records/query', {
      filter: { email_addresses: { email_address: { $eq: email } } },
      limit: LOOKUP_LIMIT + 1,
      offset: 0,
    }));
    if (!result.success) throw new AttioError('Attio returned an unexpected person response.');
    return result.data.data;
  }

  async record(object: string, recordId: string): Promise<AttioRecord | undefined> {
    let body: unknown;
    try {
      body = await this.request(`/v2/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(recordId)}`);
    } catch (error) {
      if (error instanceof AttioError && error.status === 404) return undefined;
      throw error;
    }
    const result = z.object({ data: recordSchema }).safeParse(body);
    if (!result.success || result.data.data.id.record_id.toLowerCase() !== recordId.toLowerCase()) {
      throw new AttioError('Attio returned an unexpected record response.');
    }
    return result.data.data;
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
    if (!response.ok) throw new AttioError(`Attio could not complete the request (HTTP ${response.status}). Try again.`, response.status);
    try {
      return await response.json();
    } catch {
      throw new AttioError('Attio returned an invalid JSON response.');
    }
  }
}
