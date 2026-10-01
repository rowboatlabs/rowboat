import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { Queryable } from './db.js';

// Sign-in codes by SMS and by email (security §4.1, decided 29/09 and
// 01/10/2026). Who sends them is a seam: an SMS aggregator per country and an
// email service plug in behind CodeSender, chosen later (architecture §3.8).

export interface CodeSender {
  /** Whether this sender can deliver at all: a method it cannot is not offered. */
  readonly email: boolean;
  readonly sms: boolean;
  sendEmailCode(email: string, code: string): Promise<void>;
  sendSmsCode(phoneE164: string, code: string): Promise<void>;
}

/** No provider chosen yet: neither method is offered. */
export class NoSender implements CodeSender {
  readonly email = false;
  readonly sms = false;
  async sendEmailCode() {
    throw new Error('No email sender configured');
  }
  async sendSmsCode() {
    throw new Error('No SMS sender configured');
  }
}

/**
 * Development only (WARELL_DEV_CODES=1): writes the code to the log instead
 * of sending it. Never in production: the log would hold every code.
 */
export class LogSender implements CodeSender {
  readonly email = true;
  readonly sms = true;
  readonly sent: Array<{ to: string; code: string }> = [];
  async sendEmailCode(email: string, code: string) {
    this.sent.push({ to: email, code });
    console.log(`[codes] ${email}: ${code}`);
  }
  async sendSmsCode(phone: string, code: string) {
    this.sent.push({ to: phone, code });
    console.log(`[codes] ${phone}: ${code}`);
  }
}

/** The 7 opening countries (architecture §3.8): only they receive SMS; others use email. */
export const SMS_PREFIXES = ['+225', '+226', '+229', '+221', '+228', '+223', '+227'];

export function smsAllowed(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone) && SMS_PREFIXES.some((p) => phone.startsWith(p));
}

export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const SENDS_PER_HOUR = 3;
export const SENDS_PER_DAY = 10;

/**
 * Counts one send to `identifier` if it stays under the caps. Over them, the
 * caller sends nothing but answers as if it had: the response never tells
 * whether an account exists, nor whether a cap was hit.
 */
export async function takeSend(db: Queryable, identifier: string, now: number): Promise<boolean> {
  const { rows } = await db.query<{ hour: unknown; day: unknown }>(
    `SELECT count(*) FILTER (WHERE at > $2) AS hour, count(*) AS day
     FROM warell.code_sends WHERE identifier = $1 AND at > $3`,
    [identifier, new Date(now - 60 * 60 * 1000), new Date(now - 24 * 60 * 60 * 1000)],
  );
  if (Number(rows[0].hour) >= SENDS_PER_HOUR || Number(rows[0].day) >= SENDS_PER_DAY) return false;
  await db.query('INSERT INTO warell.code_sends (identifier, at) VALUES ($1, $2)', [identifier, new Date(now)]);
  return true;
}

const hash = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}`).digest();

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** A new phone code replaces the previous one; only its hash is kept. */
export async function storePhoneCode(db: Queryable, phone: string, code: string, now: number): Promise<void> {
  await db.query(
    `INSERT INTO warell.phone_codes (phone_e164, code_hash, attempts, expires_at) VALUES ($1, $2, 0, $3)
     ON CONFLICT (phone_e164) DO UPDATE SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at`,
    [phone, hash(phone, code).toString('hex'), new Date(now + CODE_TTL_MS)],
  );
}

/** Single use, 5 minutes, 5 attempts: a wrong guess counts even when the code has expired. */
export async function checkPhoneCode(db: Queryable, phone: string, code: string, now: number): Promise<boolean> {
  const { rows } = await db.query<{ code_hash: string; attempts: number; expires_at: Date }>(
    `UPDATE warell.phone_codes SET attempts = attempts + 1 WHERE phone_e164 = $1
     RETURNING code_hash, attempts, expires_at`,
    [phone],
  );
  const row = rows[0];
  if (!row || row.attempts > MAX_ATTEMPTS || row.expires_at.getTime() <= now) return false;
  const ok = timingSafeEqual(Buffer.from(row.code_hash, 'hex'), hash(phone, code));
  if (ok) await db.query('DELETE FROM warell.phone_codes WHERE phone_e164 = $1', [phone]);
  return ok;
}
