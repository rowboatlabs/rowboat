import * as tls from 'node:tls';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/**
 * Extracts individual PEM certificate strings from a concatenated PEM string or file.
 */
export function splitPemCertificates(pemText: string): string[] {
  if (!pemText || typeof pemText !== 'string') return [];
  const matches = pemText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!matches) return [];
  return matches.map((cert) => cert.trim()).filter((cert) => cert.length > 0);
}

/**
 * Normalizes a PEM certificate by stripping headers, footers, and whitespace.
 * Useful for reliable deduplication across line-ending variants.
 */
export function normalizePem(cert: string): string {
  return cert
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

/**
 * Validates that a PEM certificate represents a currently valid TLS trust anchor (CA).
 * Rejects expired certificates, non-CA leaf certificates, and certificates without
 * certificate-signing capability.
 */
export function isValidTlsTrustAnchor(certPem: string, nowMs = Date.now()): boolean {
  try {
    const x509 = new crypto.X509Certificate(certPem);
    const validFrom = new Date(x509.validFrom).getTime();
    const validTo = new Date(x509.validTo).getTime();

    // 1. Must be currently valid
    if (nowMs < validFrom || nowMs > validTo) {
      return false;
    }

    // 2. Must be a CA (Basic Constraints CA:TRUE) or self-signed root
    const isSelfSigned = x509.subject === x509.issuer;
    if (!x509.ca && !isSelfSigned) {
      return false;
    }

    // 3. Key Usage: if present, must permit certificate signing (keyCertSign)
    if (x509.keyUsage && Array.isArray(x509.keyUsage) && x509.keyUsage.length > 0) {
      const hasCertSign = x509.keyUsage.includes('keyCertSign') || x509.keyUsage.includes('Certificate Sign');
      if (!hasCertSign) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Standard Linux certificate bundle paths ordered by likelihood.
 */
export const LINUX_CA_BUNDLE_PATHS = [
  '/etc/ssl/certs/ca-certificates.crt', // Debian, Ubuntu, Gentoo
  '/etc/pki/tls/certs/ca-bundle.crt', // Fedora, RHEL, CentOS
  '/etc/ssl/ca-bundle.pem', // OpenSUSE
  '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem', // Newer RHEL/CentOS
  '/etc/ssl/cert.pem', // Alpine, Arch, OpenBSD, FreeBSD
];

let cachedCertificates: string[] | null = null;
let isPatched = false;
let origCreateSecureContext: typeof tls.createSecureContext | null = null;
let origDefaultCACerts: string[] | null = null;

/**
 * Resets the in-memory cache and patches. Intended primarily for unit and integration tests.
 */
export function resetSystemCertificatesCache(): void {
  cachedCertificates = null;

  if (isPatched) {
    if (origCreateSecureContext) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cjsTls = typeof require === 'function' ? require('node:tls') : (tls as unknown as Record<string, unknown>);
        cjsTls.createSecureContext = origCreateSecureContext;
      } catch {
        // Ignore unpatch error in test reset
      }
      origCreateSecureContext = null;
    }
    isPatched = false;
  }

  if (
    origDefaultCACerts !== null &&
    typeof (tls as unknown as { setDefaultCACertificates?: (certs: string[]) => void }).setDefaultCACertificates === 'function'
  ) {
    try {
      (tls as unknown as { setDefaultCACertificates: (certs: string[]) => void }).setDefaultCACertificates(origDefaultCACerts);
    } catch {
      // Ignore reset failure in testing
    }
    origDefaultCACerts = null;
  }
}

export interface ExtractCertificatesOptions {
  platform?: NodeJS.Platform;
  execFile?: typeof execFileSync;
  caBundlePaths?: string[];
  keychainPaths?: string[];
  fileExists?: (path: string) => boolean;
}

/**
 * Queries the platform-specific OS trust store to extract certificates in PEM format.
 *
 * Trust Semantics:
 * - Windows: Queries only the 'Root' store (Trusted Root Certification Authorities) in
 *   LocalMachine and CurrentUser scopes. Filters out expired, disallowed, and non-TLS CAs.
 *   Does NOT query intermediate 'CA' stores to avoid promoting intermediates to trust anchors.
 * - macOS: Queries system root and administrator keychains (/Library/Keychains/System.keychain
 *   and /System/Library/Keychains/SystemRootCertificates.keychain).
 * - Linux: Reads standard consolidated distribution CA bundle files.
 */
export function extractHostCertificates(options: ExtractCertificatesOptions = {}): string[] {
  const currentPlatform = options.platform ?? process.platform;
  const exec = options.execFile ?? execFileSync;
  const bundlePaths = options.caBundlePaths ?? LINUX_CA_BUNDLE_PATHS;
  const fileExists = options.fileExists ?? fs.existsSync;
  const extracted: string[] = [];

  try {
    if (currentPlatform === 'darwin') {
      // macOS: query system administrator keychain (where corporate MDM / TLS inspection CAs are installed).
      // We deliberately exclude /System/Library/Keychains/SystemRootCertificates.keychain because Apple's
      // built-in system roots duplicate Node's Mozilla roots, contain non-TLS anchors, and cannot host
      // enterprise inspection proxies (which are installed by MDM into /Library/Keychains/System.keychain).
      // Note on limitation: /usr/bin/security find-certificate exports raw certificates and does not evaluate
      // SecTrustSettings denials or per-policy trust rules; true parity requires native Security framework bindings.
      const keychains = options.keychainPaths ?? ['/Library/Keychains/System.keychain'];
      for (const keychain of keychains) {
        try {
          if (fileExists(keychain)) {
            const stdout = exec('/usr/bin/security', ['find-certificate', '-a', '-p', keychain], {
              encoding: 'utf8',
              timeout: 10_000,
              stdio: ['ignore', 'pipe', 'ignore'],
            });
            extracted.push(...splitPemCertificates(stdout));
          }
        } catch {
          // Ignore failure reading a specific keychain
        }
      }
    } else if (currentPlatform === 'win32') {
      // Windows: Query Root (Trusted Root Certification Authorities) in LocalMachine and CurrentUser.
      // Explicitly check for Disallowed store, validity period, and Server Authentication EKU.
      const psScript = `
$now = [DateTime]::UtcNow;
$disallowedHashes = @();
try {
  $dStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Disallowed', 'LocalMachine');
  $dStore.Open('ReadOnly');
  $disallowedHashes += @($dStore.Certificates | ForEach-Object { $_.Thumbprint });
  $dStore.Close();
} catch {}
try {
  $duStore = New-Object System.Security.Cryptography.X509Certificates.X509Store('Disallowed', 'CurrentUser');
  $duStore.Open('ReadOnly');
  $disallowedHashes += @($duStore.Certificates | ForEach-Object { $_.Thumbprint });
  $duStore.Close();
} catch {}

$locations = 'LocalMachine', 'CurrentUser';
$output = foreach ($loc in $locations) {
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', $loc);
    $store.Open('ReadOnly');
    foreach ($c in $store.Certificates) {
      if ($disallowedHashes -contains $c.Thumbprint) { continue; }
      if ($c.NotAfter -le $now -or $c.NotBefore -ge $now) { continue; }
      $serverAuth = $true;
      $ekuExt = $c.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' };
      if ($ekuExt) {
        $oids = @($ekuExt.EnhancedKeyUsages | ForEach-Object { $_.Value });
        if ($oids -notcontains '1.3.6.1.5.5.7.3.1' -and $oids -notcontains '2.5.29.37.0') {
          $serverAuth = $false;
        }
      }
      if (-not $serverAuth) { continue; }

      '-----BEGIN CERTIFICATE-----';
      [Convert]::ToBase64String($c.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert), 'InsertLineBreaks');
      '-----END CERTIFICATE-----';
    };
    $store.Close();
  } catch {}
};
$output -join [Environment]::NewLine;
`.trim().replace(/\r?\n/g, ' ');

      const stdout = exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      extracted.push(...splitPemCertificates(stdout));
    } else if (currentPlatform === 'linux') {
      // Linux: read the first existing system CA bundle file
      for (const bundlePath of bundlePaths) {
        try {
          if (fileExists(bundlePath)) {
            const content = fs.readFileSync(bundlePath, 'utf8');
            extracted.push(...splitPemCertificates(content));
            break;
          }
        } catch {
          // Continue to next candidate path
        }
      }
    }
  } catch (error) {
    console.warn('[system-ca] warning: failed to query host system certificates:', (error as Error).message);
  }

  // Filter all extracted certificates with X509 validation (CA constraint, validity date)
  return extracted.filter((cert) => isValidTlsTrustAnchor(cert));
}

/**
 * Retrieves CA certificates from the host operating system trust store
 * (macOS Keychain, Windows Certificate Store, or Linux standard CA bundles),
 * deduplicated against Node's built-in Mozilla root certificates.
 */
export function getSystemCertificates(options?: ExtractCertificatesOptions): string[] {
  if (cachedCertificates !== null && !options) {
    return cachedCertificates;
  }

  // Allow explicit opt-out via environment variable
  if (process.env.ROWBOAT_DISABLE_SYSTEM_CA === '1' || process.env.ROWBOAT_DISABLE_SYSTEM_CA === 'true') {
    if (!options) cachedCertificates = [];
    return [];
  }

  const extracted = extractHostCertificates(options);

  // If the user already specified NODE_EXTRA_CA_CERTS, preserve and read those certs too
  if (process.env.NODE_EXTRA_CA_CERTS) {
    try {
      if (fs.existsSync(process.env.NODE_EXTRA_CA_CERTS)) {
        const extraContent = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
        const extraCerts = splitPemCertificates(extraContent).filter((c) => isValidTlsTrustAnchor(c));
        extracted.push(...extraCerts);
      }
    } catch {
      // Ignore unreadable NODE_EXTRA_CA_CERTS
    }
  }

  // Base certificates: use active getCACertificates() or default tls.rootCertificates
  const knownCerts = new Set<string>();
  const baseCerts =
    typeof (tls as unknown as { getCACertificates?: () => string[] }).getCACertificates === 'function'
      ? (tls as unknown as { getCACertificates: () => string[] }).getCACertificates()
      : tls.rootCertificates;

  if (Array.isArray(baseCerts)) {
    for (const cert of baseCerts) {
      knownCerts.add(normalizePem(cert));
    }
  }

  const uniqueSystemCAs: string[] = [];
  const seen = new Set<string>();

  for (const cert of extracted) {
    const norm = normalizePem(cert);
    if (norm && !knownCerts.has(norm) && !seen.has(norm)) {
      seen.add(norm);
      uniqueSystemCAs.push(cert);
    }
  }

  if (!options) {
    cachedCertificates = uniqueSystemCAs;
  }
  return uniqueSystemCAs;
}

/**
 * Initializes system CA certificate integration in the current process.
 * Configures the Node runtime so all outbound HTTPS/TLS requests (via fetch,
 * node:https, or AI SDK providers) automatically trust the operating system's
 * installed root/intermediate CAs in addition to Node's default root certificates.
 *
 * Design:
 * 1. Uses the official, supported public Node.js API `tls.setDefaultCACertificates`
 *    available in Node >= 22.13.0 and Electron >= 39.
 * 2. Invariant: Preserves Node's built-in Mozilla root certificates and existing CA configuration.
 * 3. Invariant: Never overrides or mutates an explicit `options.ca` provided by the caller,
 *    preserving certificate pinning, custom client CA configurations, and existing setups.
 * 4. Provides a fallback hook on `tls.createSecureContext` only if `setDefaultCACertificates`
 *    is not available in the runtime.
 */
export function initSystemCertificates(options?: ExtractCertificatesOptions): { installed: boolean; count: number } {
  // Allow explicit opt-out
  if (process.env.ROWBOAT_DISABLE_SYSTEM_CA === '1' || process.env.ROWBOAT_DISABLE_SYSTEM_CA === 'true') {
    return { installed: false, count: 0 };
  }

  const certs = getSystemCertificates(options);

  if (!isPatched) {
    const setDefaultCA = (tls as unknown as { setDefaultCACertificates?: (c: string[]) => void }).setDefaultCACertificates;
    let setDefaultSucceeded = false;

    if (typeof setDefaultCA === 'function' && certs.length > 0) {
      try {
        if (origDefaultCACerts === null) {
          const currentDefaults =
            typeof (tls as unknown as { getCACertificates?: () => string[] }).getCACertificates === 'function'
              ? (tls as unknown as { getCACertificates: () => string[] }).getCACertificates()
              : tls.rootCertificates;
          origDefaultCACerts = Array.isArray(currentDefaults) ? [...currentDefaults] : [];
        }
        const baseCerts = origDefaultCACerts.length > 0 ? origDefaultCACerts : (tls.rootCertificates ?? []);
        const combined = [...baseCerts, ...certs];
        setDefaultCA(combined);
        setDefaultSucceeded = true;
      } catch (err) {
        console.warn('[system-ca] warning: failed to setDefaultCACertificates:', (err as Error).message);
      }
    }

    // Fallback hook on tls.createSecureContext only if setDefaultCACertificates was not available
    if (!setDefaultSucceeded) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const cjsTls = typeof require === 'function' ? require('node:tls') : tls;
        origCreateSecureContext = cjsTls.createSecureContext;

        cjsTls.createSecureContext = function (secureOptions?: tls.SecureContextOptions) {
          const context = origCreateSecureContext!.call(this, secureOptions);

          // If caller explicitly provided `ca`, respect their configuration and do not mutate
          if (secureOptions && secureOptions.ca) {
            return context;
          }

          const activeCerts = getSystemCertificates(options);
          const internalContext = (context as unknown as { context?: { addCACert?: (c: string) => void } }).context;

          if (internalContext && typeof internalContext.addCACert === 'function') {
            for (const cert of activeCerts) {
              try {
                internalContext.addCACert(cert);
              } catch {
                // Skip any individual malformed certificate without failing connection
              }
            }
          }

          return context;
        };
      } catch (err) {
        console.warn('[system-ca] warning: failed to hook tls.createSecureContext fallback:', (err as Error).message);
      }
    }

    isPatched = true;
  }

  return { installed: true, count: certs.length };
}

/**
 * Writes all deduplicated system and extra certificates into a PEM bundle file on disk.
 * Uses atomic write with 0o600 permissions and avoids unnecessary rewrites when content is unchanged.
 * Prevents overwriting symlinks or existing user-managed files outside the intended target.
 * Useful for passing to subprocesses or child servers via NODE_EXTRA_CA_CERTS.
 */
export function writeSystemCaBundle(targetFilePath: string, options?: ExtractCertificatesOptions): string | null {
  try {
    const certs = getSystemCertificates(options);
    if (certs.length === 0) return null;

    const dir = path.dirname(targetFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = certs.join('\n\n') + '\n';

    // If file already exists: check if it's a symlink or already has identical content
    if (fs.existsSync(targetFilePath)) {
      try {
        const stat = fs.lstatSync(targetFilePath);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(targetFilePath);
        } else {
          const existing = fs.readFileSync(targetFilePath, 'utf8');
          if (existing === content) {
            return targetFilePath;
          }
        }
      } catch {
        // Proceed with atomic write if check fails
      }
    }

    // Write atomically via a temporary file with restrictive permissions (0o600)
    const tmpPath = `${targetFilePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpPath, targetFilePath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup error
      }
      throw err;
    }

    return targetFilePath;
  } catch (error) {
    console.warn('[system-ca] warning: failed to write system CA bundle:', (error as Error).message);
    return null;
  }
}
