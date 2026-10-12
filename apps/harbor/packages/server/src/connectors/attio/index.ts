import { domainToASCII } from 'node:url';
import { z } from 'zod';
import { integrationPlatform, UsageError } from '../commands.js';
import type { ConnectorPlatform } from '../platforms.js';
import { AttioApi, LOOKUP_LIMIT, type AttioCompany, type AttioPerson, type AttioRecord } from './client.js';

function companyDomain(args: string): string {
  const input = args.trim().replace(/\.$/, '');
  const invalid = () => new UsageError('Give a company domain, such as acme.com, without a URL path or email address.');
  if (!input || /[\s/:@?#%\\]/.test(input)) throw invalid();
  const domain = domainToASCII(input).toLowerCase();
  const labels = domain.split('.');
  if (domain.length > 253 || labels.length < 2 || /^\d+$/.test(labels.at(-1)!) ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw invalid();
  return domain;
}

function personEmail(args: string): string {
  const parts = args.trim().split('@');
  if (parts.length !== 2 || /[\s/:?#%\\]/.test(parts[1]!)) throw new UsageError('Give one email address, such as jane@acme.com.');
  const email = `${parts[0]}@${domainToASCII(parts[1]!)}`.toLowerCase();
  if (!z.email().safeParse(email).success || email.length > 254 || parts[0]!.length > 64) {
    throw new UsageError('Give one email address, such as jane@acme.com.');
  }
  return email;
}

// Escaped Markdown alone still matches Spaces' mention grammar; entities keep
// CRM text from addressing members or agents (spec §8 Attio, 2026-10-12).
function plainText(value: string, limit: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  const text = flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  return text.replace(/[&<>\[\]`*_\\|()#!]/g, (char) => `&#${char.charCodeAt(0)};`);
}

const current = <T extends { active_until?: string | null }>(values: T[] = []) => values.filter((value) => !value.active_until);

function companySummary(company: AttioCompany): string {
  const name = current(company.values.name)[0]?.value || 'Unnamed company';
  const description = current(company.values.description)[0]?.value;
  const domains = current(company.values.domains).slice(0, 5).map((value) => plainText(value.domain, 253));
  const lines = [`**${plainText(name, 160)}**`];
  if (domains.length) lines.push(`Domains: ${domains.join(', ')}`);
  if (description) lines.push(plainText(description, 500));
  return [...lines, ...recordFooter(company)].join('\n\n');
}

function personSummary(person: AttioPerson): string {
  const name = current(person.values.name)[0];
  const displayName = name?.full_name?.trim() || [name?.first_name, name?.last_name].filter(Boolean).join(' ').trim() || 'Unnamed person';
  const emails = current(person.values.email_addresses).slice(0, 5).map((value) => plainText(value.email_address, 254));
  const title = current(person.values.job_title)[0]?.value;
  const lines = [`**${plainText(displayName, 160)}**`];
  if (emails.length) lines.push(`Email: ${emails.join(', ')}`);
  if (title) lines.push(`Job title: ${plainText(title, 200)}`);
  return [...lines, ...recordFooter(person)].join('\n\n');
}

function recordFooter(record: { id: { record_id: string }; web_url?: string }): string[] {
  const lines = [`Record ID: \`${record.id.record_id}\``];
  if (record.web_url) {
    try {
      const url = new URL(record.web_url);
      if (url.origin === 'https://app.attio.com' && !url.username && !url.password && url.href.length <= 2048) {
        const href = url.href.replace(/[<>\[\]`\\]/g, (char) => `%${char.charCodeAt(0).toString(16)}`);
        lines.push(`[Open in Attio](<${href}>)`);
      }
    } catch { /* A missing or invalid external link does not hide the record (spec §8 Attio, 2026-10-12). */ }
  }
  return lines;
}

function lookupReply<T>(records: T[], noun: string, query: string, format: (record: T) => string): string {
  const subject = plainText(query, 254);
  if (!records.length) return `No ${noun} found for **${subject}**.`;
  const heading = records.length === 1 ? '' : records.length > LOOKUP_LIMIT
    ? `More than ${LOOKUP_LIMIT} ${noun} match **${subject}**. Showing the first ${LOOKUP_LIMIT}; open Attio to review all matches.\n\n`
    : `${records.length} ${noun} match **${subject}**.\n\n`;
  return heading + records.slice(0, LOOKUP_LIMIT).map(format).join('\n\n---\n\n');
}

function attributeText(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (v.active_until != null) return undefined;
  const text = (key: string) => typeof v[key] === 'string' ? v[key] as string : undefined;
  const title = (key: string) => {
    const nested = v[key];
    if (nested && typeof nested === 'object' && 'title' in nested && typeof nested.title === 'string') return nested.title;
    return undefined;
  };
  switch (v.attribute_type) {
    case 'text': case 'date': case 'timestamp': return text('value');
    case 'number': case 'rating': return typeof v.value === 'number' && Number.isFinite(v.value) ? String(v.value) : undefined;
    case 'checkbox': return typeof v.value === 'boolean' ? (v.value ? 'Yes' : 'No') : undefined;
    case 'domain': return text('domain');
    case 'email-address': return text('email_address');
    case 'personal-name': return text('full_name') || [text('first_name'), text('last_name')].filter(Boolean).join(' ');
    case 'select': return title('option');
    case 'status': return title('status');
    case 'currency': {
      const amount = v.currency_value;
      if (text('currency_code') && ((typeof amount === 'number' && Number.isFinite(amount)) ||
          (typeof amount === 'string' && /^-?\d+(?:\.\d+)?$/.test(amount)))) return `${text('currency_code')} ${amount}`;
      return undefined;
    }
    case 'record-reference': {
      const target = text('target_object');
      const id = text('target_record_id');
      return target && id ? `${target}: ${id}` : undefined;
    }
    default: return undefined;
  }
}

function recordSummary(record: AttioRecord, object: string): string {
  const rows: string[] = [];
  for (const [key, values] of Object.entries(record.values)) {
    const formatted = values.map(attributeText).filter((value): value is string => Boolean(value?.trim()));
    if (!formatted.length) continue;
    const more = formatted.length > 5 ? ` (+${formatted.length - 5} more)` : '';
    rows.push(`- **${plainText(key, 80)}:** ${plainText(formatted.slice(0, 5).join(', '), 300)}${more}`);
  }
  const lines = [`**Attio record · ${plainText(object, 128)}**`, ...recordFooter(record)];
  if (!rows.length) lines.push('No supported current fields to display.');
  else lines.push(rows.slice(0, 20).join('\n'));
  if (rows.length > 20) lines.push('Showing the first 20 fields; open Attio to see the full record.');
  return lines.join('\n\n');
}

export function attioPlatform(baseUrl?: string): ConnectorPlatform {
  return integrationPlatform({
    label: 'Attio',
    client: (secret) => new AttioApi(secret, baseUrl),
    check: (api) => api.check(),
    commands: [{
      name: 'company',
      args: '<domain>',
      summary: 'find companies by exact domain, such as acme.com',
      async run(api, args) {
        const domain = companyDomain(args);
        return lookupReply(await api.companies(domain), 'companies', domain, companySummary);
      },
    }, {
      name: 'person',
      args: '<email>',
      summary: 'find people by exact email, such as jane@acme.com',
      async run(api, args) {
        const email = personEmail(args);
        return lookupReply(await api.people(email), 'people', email, personSummary);
      },
    }, {
      name: 'record',
      args: '<object> <record-id>',
      summary: 'read a standard or custom object record by its UUID',
      async run(api, args) {
        const parts = args.trim().split(/\s+/);
        const [object = '', recordId = ''] = parts;
        if (parts.length !== 2 || !/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(object) || !z.uuid().safeParse(recordId).success) {
          throw new UsageError('Give an object slug or UUID and a record UUID, such as companies <record-id>.');
        }
        const record = await api.record(object, recordId);
        return record ? recordSummary(record, object) : `Record \`${recordId}\` in **${plainText(object, 128)}** was not found or is unavailable.`;
      },
    }],
  });
}
