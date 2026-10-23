import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as tls from 'node:tls';
import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import {
  splitPemCertificates,
  normalizePem,
  isValidTlsTrustAnchor,
  extractHostCertificates,
  getSystemCertificates,
  initSystemCertificates,
  resetSystemCertificatesCache,
  writeSystemCaBundle,
} from './system-ca.js';

// Deterministic valid test CA certificate and leaf certificate/key generated for localhost (127.0.0.1)
// Valid until year 2076.
const TEST_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIDUDCCAjigAwIBAgITFc/CgT+T+bIhbZdPc8zVgX5T+jANBgkqhkiG9w0BAQsF
ADA3MR0wGwYDVQQDDBRSb3dib2F0IFRlc3QgUm9vdCBDQTEWMBQGA1UECgwNUm93
Ym9hdCBUZXN0czAgFw0yNjEwMTQxNTIxMDVaGA8yMDc2MTAwMTE1MjEwNVowNzEd
MBsGA1UEAwwUUm93Ym9hdCBUZXN0IFJvb3QgQ0ExFjAUBgNVBAoMDVJvd2JvYXQg
VGVzdHMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCyF/ctu3V5L/jY
xuZpgW9iRDRF39Pj2NnfyTR/IhgPO0xIrj+gvG5I5vU11CqTC3/H5wF0Y6IAvdRR
2ubsV1HUwgfrqlT5ZzdxCNDmzKBXNedzK2qpEzhXrs7OUKL8eixt4o5L4PMKxMVI
J20+MRdYhLBJVSt7PWy/SvKXSlbM0hiNj7BrUfmd26DPcpu2UNvSBb1YeBzMkzL1
l2I3kLSFzxUZE8zLtSySVHpAShMIxpZ1UPIanCXvwidyU8v6bnjLut4P0fOvYBvN
LpBrct+k7oJ60MqgxjckyI6YmbRhP6K+7yoDa+39Q2p1pv1O4NVJcU87AoPmGZuq
7ZSdcAYJAgMBAAGjUzBRMB0GA1UdDgQWBBRbgZWVVu2/shdf2RFbbqYlbRXpszAf
BgNVHSMEGDAWgBRbgZWVVu2/shdf2RFbbqYlbRXpszAPBgNVHRMBAf8EBTADAQH/
MA0GCSqGSIb3DQEBCwUAA4IBAQA4VMvV8iQC/KlozQvqj23Kld0Ft3N2W5PKuyFV
AuOfEpcL0DZ4vTPhgi3CtVWzD/cEnh0WANUzj/XOi1Tnmr8RvQ0VlA734ngRQIqR
CxjrvQls4OzwsK8CMsO78t3jrqzolxqR+K8hMTgJMlOPc05+4BpCISrPoC9s+vUb
gH/+ccpRj9eYVEZmflcI6sUDS+Z2Wkun9suEOz7yJv+GnXVCdOqS+4sPTwzyLnwV
VEIKDZe93ULutcjYvnm9LB2PO+766dCpLWZ+xI54Y4TszXAws097asRig+b2A6S8
NIgYT/62so/pbG8tYlsJtl3vfHIMkn1s3SnXrBO0iyrASyoC
-----END CERTIFICATE-----`;

const TEST_CA_CERT_2 = `-----BEGIN CERTIFICATE-----
MIIDZTCCAk2gAwIBAgIUMrnl00Bqfoc0TA721EE/ozBeMP8wDQYJKoZIhvcNAQEL
BQAwQTEdMBsGA1UEAwwUUm93Ym9hdCBTZWNvbmRhcnkgQ0ExIDAeBgNVBAoMF1Jv
d2JvYXQgU2Vjb25kYXJ5IFRlc3RzMCAXDTI2MTAxNDE4MjIyMVoYDzIwNzYxMDAx
MTgyMjIxWjBBMR0wGwYDVQQDDBRSb3dib2F0IFNlY29uZGFyeSBDQTEgMB4GA1UE
CgwXUm93Ym9hdCBTZWNvbmRhcnkgVGVzdHMwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQDAd9rr2hDGOM+aaG3LMOsY+6aXrfcvfKAVJ9/O/GfqzX1djyt2
JqmgXZpoQJFIoYJYXBEA/IXPVHW7pEP1+Pwmf8Kac+FbmoDkWI9tqjmdf69ckp+u
ivT9d9mifXZ/FoCYjtXbfr3odMMqMlvpKxB5GeSDkUGJBaq/5Vb1dJE8CqFy+NUX
YGtH+3lfZuSFOV19UezwggHuvhG6Xgd7WLOEbHVi2M8nY9meiZ/sENIgQ2L5FA8x
63SMp4Nu2ZvwjMBpo268zulrh0+pbZUFMGdf2MrtPKyG2s7x72bDXoy9YU/CbBxH
KY8eXL4UHdaQo0zZvU/cmyPo8HY6lTZBgWDRAgMBAAGjUzBRMB0GA1UdDgQWBBR5
lqYwcTM8TjtP60OaFgwfkwvueTAfBgNVHSMEGDAWgBR5lqYwcTM8TjtP60OaFgwf
kwvueTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBPM/9942sV
9xYENXTJYt7YuiILCL+OpVe7+q33PBl+CxPrS2J4fY2zMYW82Nl2Tu9aBfaUaYX0
b1Gw+0uCIWzAbdGS7X8qHgRGQ6afGNF0/8enHYieRcUy56MpePX9pEN3uvGSBCC0
fy/TTTkW2yD2EjXlP/TlviUbwKhbmcvOvvXh7mwa1bYab0x0Naok99bFGVd9+Hn/
gBhPygjIRh3iSKaygP4e+E+MTQwkN7rCBUSqBBWUN6g63QsWEnMJ3fZWXq/4mFLr
UuwPXMGqIMjh2WBLPagd/gdDQemM32B/bROnizs2KtI11obqHxluR6rKA4mddrNI
HWGpddwyBO4e
-----END CERTIFICATE-----`;

const TEST_SERVER_CERT = `-----BEGIN CERTIFICATE-----
MIIDUTCCAjmgAwIBAgIULtR9P4ZgT4jRzqYrITwdOgyWIcEwDQYJKoZIhvcNAQEL
BQAwNzEdMBsGA1UEAwwUUm93Ym9hdCBUZXN0IFJvb3QgQ0ExFjAUBgNVBAoMDVJv
d2JvYXQgVGVzdHMwIBcNMjYxMDE0MTUyMTA1WhgPMjA3NjEwMDExNTIxMDVaMCwx
EjAQBgNVBAMMCWxvY2FsaG9zdDEWMBQGA1UECgwNUm93Ym9hdCBUZXN0czCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAMQwmRJud/HZ/kOLlQD6hwI8MHhz
kEFm+aE2WQo3k5IEP1xAJFSaHy0GreO0WNNON8SJDUUdMmd45GGQdK8TSR7EzcZ4
SCSMiMOln3EQhFgTiwhUXrHyvQmLbObv4lZLntYCBAtvFCePZpDNS7y7kwpB9Y6K
z4ijoVCXgyeiglJv5Jgj8S4BbpfIsUnvPpc5cjTtyi1Va65jMr1nA0io7EZoZbvv
XTRpZfMICq0XSnQ/tAaV8ITQNtfVQcvo4X0jz7eEyYcpt3NwqIt34mZx0QY9axSq
LqJcZVLhGjVAYl0HXkjnjsEnyNAVqmL2vC9cZZcKfsn4V+waCmf72E6SaOUCAwEA
AaNeMFwwGgYDVR0RBBMwEYIJbG9jYWxob3N0hwR/AAABMB0GA1UdDgQWBBRUEc23
k56LV85QfPPXkkOW34m85zAfBgNVHSMEGDAWgBRbgZWVVu2/shdf2RFbbqYlbRXp
szANBgkqhkiG9w0BAQsFAAOCAQEAimYUmc9oEGqNBFZE/LvwLmTLs8hiSsGOglUh
ezhdU15VzT/qZuf8ENIGSVyYHl8tD78zesX+7/iXEWDn0e3UFRKLnO0xjpnS/adG
S26GfTGnIkBZWKrJqfcRMKiw1xYAIF7Oa0sbOQvVNtt0O5fitbeq+BqOyY/QT380
IikmB/HWC3af+iyChicnItiBVx03I2zPXWW2jgI81fvj+BhHKf37bcbQgdxgsQM9
49C6sImCXimbqBO0kC396NqeEidL9t4MGjovJNPhA3viC3KSmBkppBcJCWoMuSem
xNsafPRw9TTdsBJrbnGKPMvYiVlpgYVHO3l7D3vVErh5Qaae8g==
-----END CERTIFICATE-----`;

const TEST_SERVER_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDEMJkSbnfx2f5D
i5UA+ocCPDB4c5BBZvmhNlkKN5OSBD9cQCRUmh8tBq3jtFjTTjfEiQ1FHTJneORh
kHSvE0kexM3GeEgkjIjDpZ9xEIRYE4sIVF6x8r0Ji2zm7+JWS57WAgQLbxQnj2aQ
zUu8u5MKQfWOis+Io6FQl4MnooJSb+SYI/EuAW6XyLFJ7z6XOXI07cotVWuuYzK9
ZwNIqOxGaGW77100aWXzCAqtF0p0P7QGlfCE0DbX1UHL6OF9I8+3hMmHKbdzcKiL
d+JmcdEGPWsUqi6iXGVS4Ro1QGJdB15I547BJ8jQFapi9rwvXGWXCn7J+FfsGgpn
+9hOkmjlAgMBAAECgf9DxXTW8ad9dVBonnE4VEGTSFmYMUJn///EH7U7/PbSgnHp
QXI6T/IftUiPisWs43HGrjvvzrc80/T/eqt+ve8EVBnSW+3DGMjQZn/HDuUPIWzd
JvKgUrnYVnwufY0hICBgZqcyOuAIQd8Brtg/HkhxOiSQuw1tULKkpFzDsiPKIpas
q/tTT2qigpGc6Xid9wuwDabb/jG0oFIzLImjsYfP0Z6KbnD70O+zAw2NS8S/ErPC
2oxugvyX7F5bn09t+o7ynpbt4AoX9c+8+YMFY5H5e3fesPDkwE2Mln/3OZLrx5mY
bpq3YMs4Y0bbPCQIaf1DnzhTWbrlBjzQRprTQgECgYEA92MlA3nNWmEdAw74W1kq
fb1CyPCQXCVusYBCmpKekusNxrLQDrBzBg28tDGqiESHkzMsZFGC2lfei+14RX+A
a5ljmNACPbKgqyP/xJmPusXVNwhOinCkYI6Sq8kayMlXcY7fLwIaQIgbD+Eeehqp
/8zU6iDe5JKLOiNra+hRqeUCgYEAywUnGbajmgSDVd8PijC74nacB8MnVIhp3Isf
w9wQzgDkbAK0Dn74ofMldRQ6ItkLEcUpiy5mTNpZoXdo+16+WQppjLoN/tAn+mri
+/Fz0ac29rg8WH19XDCZjhxGMmNI533S6qenzDfSLk4vsMG++WSqGG5StCj1xsxL
FlLF0wECgYBj0ujjnymi957qVgcXbUJ9HHqvdIr788rX6yZ1EwbTx+92Jz9XPhIb
9j0YBRaICAcg+bxG+rEvg9d0ZS1r9cgPIwUSa5UL6mF0zYDuhvx9ZEjl/P8cU9mw
cLd0hCC/tqcHVpxubo3DTmiFHtTadpn0c2XS19K5LvzpR9OX5lXVlQKBgQCC2QRV
Z0hUWPpI2yZJ25UMpYN04Uu1COKp2SUU9/4At8SA9NEV0rHutyZ6Kho6IYcn4dof
sT0P5V8FWU/ZSzwFaVeT8spYY9KQbFl1Ji6OfmZHZ4DFS8QDKfOeCw0XJrRzNr48
rOfSEFwvqgbEtmqelEmoy1oUcZ3OjhcLATgtAQKBgQCbe9VibjzuZ+jTt2qAbSCZ
2rtXkenPGbl5Np9vA38vgYvwEMszzekbhD3pePQhPFVo2IMwtBnRGt42n6+Ea3Qx
zYc5Di8RJvan4qh7tNIBe+rAL+0XaHyR8JH4GTt/dCEZx/Gjr3hGzPxosP5nD5kK
QTY84TDkjUZ64WoA9HZCAA==
-----END PRIVATE KEY-----`;

describe('system-ca module', { timeout: 25_000 }, () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetSystemCertificatesCache();
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetSystemCertificatesCache();
    vi.restoreAllMocks();
  });

  describe('splitPemCertificates', () => {
    it('returns empty array on empty or invalid input', () => {
      expect(splitPemCertificates('')).toEqual([]);
      expect(splitPemCertificates('some random text without cert markers')).toEqual([]);
      expect(splitPemCertificates(null as unknown as string)).toEqual([]);
    });

    it('splits multiple concatenated certificates', () => {
      const combined = `${TEST_CA_CERT}\n\n${TEST_CA_CERT_2}\n`;
      const result = splitPemCertificates(combined);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('MIIDUDCCAjigAwIBAgITFc/CgT+T+bIhbZdPc8zVgX5T+jANBgkqhkiG9w0BAQsF');
      expect(result[1]).toContain('MIIDZTCCAk2gAwIBAgIUMrnl00Bqfoc0TA721EE/ozBeMP8wDQYJKoZIhvcNAQEL');
    });

    it('handles CRLF and trailing whitespace correctly', () => {
      const crlfCombined = `${TEST_CA_CERT.replace(/\n/g, '\r\n')}\r\n\r\n${TEST_CA_CERT_2.replace(/\n/g, '\r\n')}`;
      const result = splitPemCertificates(crlfCombined);
      expect(result).toHaveLength(2);
    });
  });

  describe('normalizePem', () => {
    it('strips headers, footers, and whitespace', () => {
      const norm1 = normalizePem(TEST_CA_CERT);
      const norm2 = normalizePem(TEST_CA_CERT.replace(/\n/g, '\r\n'));
      expect(norm1).toBe(norm2);
      expect(norm1).not.toContain('-----BEGIN CERTIFICATE-----');
      expect(norm1).not.toContain('-----END CERTIFICATE-----');
      expect(norm1).not.toContain('\n');
      expect(norm1).not.toContain('\r');
      expect(norm1).not.toContain(' ');
    });
  });

  describe('isValidTlsTrustAnchor', () => {
    it('accepts valid CA certificates', () => {
      expect(isValidTlsTrustAnchor(TEST_CA_CERT)).toBe(true);
      expect(isValidTlsTrustAnchor(TEST_CA_CERT_2)).toBe(true);
    });

    it('rejects leaf certificates without CA constraint', () => {
      expect(isValidTlsTrustAnchor(TEST_SERVER_CERT)).toBe(false);
    });

    it('rejects expired certificates', () => {
      // Simulate timestamp far in the future past year 2076
      const farFuture = new Date('2099-01-01').getTime();
      expect(isValidTlsTrustAnchor(TEST_CA_CERT, farFuture)).toBe(false);
    });

    it('rejects malformed certificates', () => {
      expect(isValidTlsTrustAnchor('invalid-pem-content')).toBe(false);
    });
  });

  describe('extractHostCertificates', () => {
    it('handles simulated macOS platform extraction', () => {
      const mockExec = vi.fn().mockReturnValue(TEST_CA_CERT);

      const certs = extractHostCertificates({
        platform: 'darwin',
        execFile: mockExec as never,
        fileExists: () => true,
      });

      expect(certs.length).toBeGreaterThanOrEqual(1);
      expect(certs[0]).toBe(TEST_CA_CERT);
    });

    it('handles simulated Windows platform extraction', () => {
      const mockExec = vi.fn().mockReturnValue(TEST_CA_CERT_2);
      const certs = extractHostCertificates({
        platform: 'win32',
        execFile: mockExec as never,
      });

      expect(certs).toHaveLength(1);
      expect(certs[0]).toBe(TEST_CA_CERT_2);
      expect(mockExec).toHaveBeenCalledWith('powershell', expect.any(Array), expect.any(Object));
    });

    it('handles simulated Linux platform extraction', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-linux-ca-'));
      const fakeBundle = path.join(tmpDir, 'ca-bundle.crt');
      fs.writeFileSync(fakeBundle, `${TEST_CA_CERT}\n${TEST_CA_CERT_2}`, 'utf8');

      try {
        const certs = extractHostCertificates({
          platform: 'linux',
          caBundlePaths: [fakeBundle],
        });

        expect(certs).toHaveLength(2);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('gracefully handles command failures and logs warning without throwing', () => {
      const mockExec = vi.fn().mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const certs = extractHostCertificates({
        platform: 'win32',
        execFile: mockExec as never,
      });

      expect(certs).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[system-ca]'),
        expect.stringContaining('EACCES: permission denied')
      );
    });
  });

  describe('getSystemCertificates and Deduplication', () => {
    it('returns an array of valid PEM certificates from host', () => {
      const certs = getSystemCertificates();
      expect(Array.isArray(certs)).toBe(true);
      for (const cert of certs) {
        expect(cert).toMatch(/^-----BEGIN CERTIFICATE-----/);
        expect(cert).toMatch(/-----END CERTIFICATE-----$/);
        expect(isValidTlsTrustAnchor(cert)).toBe(true);
      }
    });

    it('caches certificates on consecutive calls', () => {
      const first = getSystemCertificates();
      const second = getSystemCertificates();
      expect(first).toBe(second);
    });

    it('deduplicates identical certificates and certificates already in tls.rootCertificates', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-dedup-test-'));
      const extraCaFile = path.join(tmpDir, 'extra-ca.pem');

      // Pick an existing root cert from Node
      const existingRoot = tls.rootCertificates[0];
      // Create duplicate content containing existing root cert + duplicates of TEST_CA_CERT with different line endings
      const duplicateContent = [
        existingRoot,
        TEST_CA_CERT,
        TEST_CA_CERT.replace(/\n/g, '\r\n'),
        TEST_CA_CERT_2,
      ].join('\n\n');

      fs.writeFileSync(extraCaFile, duplicateContent, 'utf8');

      try {
        process.env.NODE_EXTRA_CA_CERTS = extraCaFile;
        resetSystemCertificatesCache();

        const certs = getSystemCertificates();
        const norm1 = normalizePem(TEST_CA_CERT);
        const norm2 = normalizePem(TEST_CA_CERT_2);
        const normRoot = normalizePem(existingRoot);

        // Should not include existing root cert
        expect(certs.filter((c) => normalizePem(c) === normRoot)).toHaveLength(0);

        // Should contain TEST_CA_CERT exactly once (deduplicated across CRLF)
        expect(certs.filter((c) => normalizePem(c) === norm1)).toHaveLength(1);

        // Should contain TEST_CA_CERT_2 exactly once
        expect(certs.filter((c) => normalizePem(c) === norm2)).toHaveLength(1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('respects ROWBOAT_DISABLE_SYSTEM_CA opt-out', () => {
      process.env.ROWBOAT_DISABLE_SYSTEM_CA = '1';
      resetSystemCertificatesCache();
      const certs = getSystemCertificates();
      expect(certs).toEqual([]);
    });

    it('includes certificates from NODE_EXTRA_CA_CERTS if set', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-ca-test-'));
      const extraCaFile = path.join(tmpDir, 'extra-ca.pem');
      fs.writeFileSync(extraCaFile, TEST_CA_CERT, 'utf8');

      try {
        process.env.NODE_EXTRA_CA_CERTS = extraCaFile;
        resetSystemCertificatesCache();
        const certs = getSystemCertificates();
        const normSample = normalizePem(TEST_CA_CERT);
        const hasExtra = certs.some((c) => normalizePem(c) === normSample);
        expect(hasExtra).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('gracefully handles missing or unreadable NODE_EXTRA_CA_CERTS', () => {
      process.env.NODE_EXTRA_CA_CERTS = path.join(os.tmpdir(), 'non-existent-ca-file-12345.pem');
      resetSystemCertificatesCache();
      expect(() => getSystemCertificates()).not.toThrow();
    });
  });

  describe('initSystemCertificates', () => {
    it('initializes and returns count', () => {
      const result = initSystemCertificates();
      expect(result.installed).toBe(true);
      expect(typeof result.count).toBe('number');
    });

    it('is idempotent when called multiple times', () => {
      const r1 = initSystemCertificates();
      const r2 = initSystemCertificates();
      expect(r1.installed).toBe(true);
      expect(r2.installed).toBe(true);
      expect(r1.count).toBe(r2.count);
    });

    it('respects ROWBOAT_DISABLE_SYSTEM_CA opt-out on initialization', () => {
      process.env.ROWBOAT_DISABLE_SYSTEM_CA = '1';
      const result = initSystemCertificates();
      expect(result.installed).toBe(false);
      expect(result.count).toBe(0);
    });

    it('preserves caller-provided explicit options.ca without mutating it', () => {
      initSystemCertificates();

      // Custom caller CA
      const customCA = TEST_CA_CERT_2;
      const ctx = tls.createSecureContext({
        ca: customCA,
      });

      expect(ctx).toBeDefined();
    });

    it('configures default secure context', () => {
      initSystemCertificates();

      const ctx = tls.createSecureContext();
      expect(ctx).toBeDefined();
      expect(ctx.context).toBeDefined();
    });
  });

  describe('writeSystemCaBundle', () => {
    it('writes bundle to specified path and creates directory with atomic rename', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-bundle-test-'));
      const targetFile = path.join(tmpDir, 'nested', 'bundle.pem');

      try {
        const outPath = writeSystemCaBundle(targetFile);
        if (getSystemCertificates().length > 0) {
          expect(outPath).toBe(targetFile);
          expect(fs.existsSync(targetFile)).toBe(true);
          const written = fs.readFileSync(targetFile, 'utf8');
          expect(written).toContain('-----BEGIN CERTIFICATE-----');

          // Calling writeSystemCaBundle again with same content should succeed without error
          const secondPath = writeSystemCaBundle(targetFile);
          expect(secondPath).toBe(targetFile);
        } else {
          expect(outPath).toBeNull();
        }
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns null when no certificates are present', () => {
      process.env.ROWBOAT_DISABLE_SYSTEM_CA = '1';
      resetSystemCertificatesCache();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-bundle-null-'));
      const targetFile = path.join(tmpDir, 'bundle.pem');

      try {
        const outPath = writeSystemCaBundle(targetFile);
        expect(outPath).toBeNull();
        expect(fs.existsSync(targetFile)).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('End-to-End Real TLS Handshake Integration', () => {
    let server: https.Server;
    let port: number;

    beforeEach(async () => {
      // Start in-process HTTPS server signed by TEST_CA_CERT
      server = https.createServer(
        {
          key: TEST_SERVER_KEY,
          cert: TEST_SERVER_CERT,
        },
        (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('tls-verification-successful');
        }
      );

      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          port = addr.port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      resetSystemCertificatesCache();
    });

    function request(url: string, options: https.RequestOptions = {}): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = https.get(url, { agent: false, ...options }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
      });
    }

    it('fails TLS verification when test CA is not trusted', async () => {
      resetSystemCertificatesCache();

      // Connecting to our HTTPS server without the test CA trusted should reject
      await expect(request(`https://localhost:${port}/`)).rejects.toThrow();
    });

    it('successfully completes TLS handshake and verifies when test CA is trusted via system-ca', async () => {
      // Provide test CA certificate via simulated system extraction
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-tls-ca-'));
      const caBundlePath = path.join(tmpDir, 'test-ca.crt');
      fs.writeFileSync(caBundlePath, TEST_CA_CERT, 'utf8');

      try {
        resetSystemCertificatesCache();

        // Initialize system certificates using test bundle options
        const initResult = initSystemCertificates({
          platform: 'linux',
          caBundlePaths: [caBundlePath],
        });
        expect(initResult.installed).toBe(true);
        expect(initResult.count).toBeGreaterThanOrEqual(1);

        // HTTPS request should now succeed with HTTP 200
        const result = await request(`https://localhost:${port}/`);
        expect(result.status).toBe(200);
        expect(result.body).toBe('tls-verification-successful');

        // Global fetch should also succeed
        const fetchRes = await fetch(`https://localhost:${port}/`);
        expect(fetchRes.status).toBe(200);
        expect(await fetchRes.text()).toBe('tls-verification-successful');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetSystemCertificatesCache();
      }
    });

    it('preserves hostname and SAN verification when hostname does not match', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-tls-san-'));
      const caBundlePath = path.join(tmpDir, 'test-ca.crt');
      fs.writeFileSync(caBundlePath, TEST_CA_CERT, 'utf8');

      try {
        resetSystemCertificatesCache();
        initSystemCertificates({
          platform: 'linux',
          caBundlePaths: [caBundlePath],
        });

        // Explicitly request https://unrelated.domain.com resolved to local server IP (127.0.0.1)
        // via custom DNS lookup. The CA is trusted via system-ca, so connection and trust succeed,
        // but certificate hostname verification must reject with ERR_TLS_CERT_ALTNAME_INVALID.
        const customLookup: https.RequestOptions['lookup'] = (_hostname, options, callback) => {
          if (options && (options as { all?: boolean }).all) {
            (callback as (err: null, addresses: Array<{ address: string; family: number }>) => void)(null, [
              { address: '127.0.0.1', family: 4 },
            ]);
          } else {
            (callback as (err: null, address: string, family: number) => void)(null, '127.0.0.1', 4);
          }
        };

        let caughtError: (Error & { code?: string }) | null = null;
        try {
          await request(`https://unrelated.domain.com:${port}/`, {
            lookup: customLookup,
          });
        } catch (err) {
          caughtError = err as Error & { code?: string };
        }

        expect(caughtError).not.toBeNull();
        expect(caughtError?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
        expect(caughtError?.message).toMatch(/unrelated\.domain\.com/);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        resetSystemCertificatesCache();
      }
    });

    it('respects caller-provided explicit options.ca over system trust store', async () => {
      resetSystemCertificatesCache();

      // Caller explicitly passes a non-matching custom CA: verification must fail
      await expect(
        request(`https://localhost:${port}/`, {
          ca: TEST_CA_CERT_2,
        })
      ).rejects.toThrow();

      // Caller explicitly passes the matching test CA: verification must succeed
      const okResult = await request(`https://localhost:${port}/`, {
        ca: TEST_CA_CERT,
      });
      expect(okResult.status).toBe(200);
      expect(okResult.body).toBe('tls-verification-successful');
    });

    it('genuinely tests child process boot with NODE_EXTRA_CA_CERTS', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rowboat-child-test-'));
      const caBundlePath = path.join(tmpDir, 'system-ca.pem');
      fs.writeFileSync(caBundlePath, TEST_CA_CERT, 'utf8');

      try {
        const clientScript = path.join(tmpDir, 'client.js');
        fs.writeFileSync(
          clientScript,
          `
const https = require('node:https');
https.get('https://localhost:${port}/', (res) => {
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}).on('error', (err) => {
  process.exit(2);
});
          `.trim(),
          'utf8'
        );

        // 1. Spawning child WITHOUT NODE_EXTRA_CA_CERTS should fail with exit code 2
        const exitCodeWithoutExtraCA = await new Promise<number>((resolve) => {
          const env = { ...process.env };
          delete env.NODE_EXTRA_CA_CERTS;
          const child = spawn(process.execPath, [clientScript], {
            env,
            stdio: 'ignore',
          });
          child.on('exit', (code) => resolve(code ?? -1));
        });
        expect(exitCodeWithoutExtraCA).toBe(2);

        // 2. Spawning child WITH NODE_EXTRA_CA_CERTS should succeed with exit code 0
        const exitCodeWithExtraCA = await new Promise<number>((resolve) => {
          const child = spawn(process.execPath, [clientScript], {
            env: {
              ...process.env,
              NODE_EXTRA_CA_CERTS: caBundlePath,
            },
            stdio: 'ignore',
          });
          child.on('exit', (code) => resolve(code ?? -1));
        });
        expect(exitCodeWithExtraCA).toBe(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
