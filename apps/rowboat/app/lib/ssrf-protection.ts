import dns from 'dns/promises';

/**
 * Validates that a URL does not resolve to a private or internal IP address.
 * Prevents Server-Side Request Forgery (SSRF) attacks by blocking requests to
 * internal network addresses (localhost, link-local, private ranges, cloud metadata).
 *
 * @param url - The URL to validate
 * @throws Error if the URL resolves to a private/internal IP or uses a non-HTTP(S) protocol
 */
export async function validateUrlAgainstSSRF(url: string): Promise<void> {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Invalid protocol: only http and https are allowed');
    }

    const hostname = parsedUrl.hostname;

    // Check for obvious localhost patterns
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
        throw new Error('Requests to localhost are not allowed');
    }

    // Resolve DNS to get actual IP addresses
    let addresses: string[];
    try {
        const result = await dns.resolve4(hostname);
        addresses = result;
    } catch {
        // If DNS resolution fails for IPv4, try IPv6
        try {
            const result = await dns.resolve6(hostname);
            addresses = result;
        } catch {
            // If hostname is already an IP, use it directly
            addresses = [hostname];
        }
    }

    for (const addr of addresses) {
        if (isPrivateIP(addr)) {
            throw new Error(`URL resolves to a private/internal IP address (${addr}), which is not allowed`);
        }
    }
}

/**
 * Checks if an IP address falls within private, loopback, link-local, or reserved ranges.
 */
function isPrivateIP(ip: string): boolean {
    // IPv4 checks
    if (isIPv4(ip)) {
        const parts = ip.split('.').map(Number);

        // Loopback: 127.0.0.0/8
        if (parts[0] === 127) return true;

        // Private: 10.0.0.0/8
        if (parts[0] === 10) return true;

        // Private: 172.16.0.0/12
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

        // Private: 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) return true;

        // Link-local: 169.254.0.0/16 (includes AWS/cloud metadata endpoint 169.254.169.254)
        if (parts[0] === 169 && parts[1] === 254) return true;

        // Broadcast: 255.255.255.255
        if (parts[0] === 255 && parts[1] === 255 && parts[2] === 255 && parts[3] === 255) return true;

        // Zero network: 0.0.0.0/8
        if (parts[0] === 0) return true;

        // 100.64.0.0/10 (Carrier-grade NAT)
        if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

        // 192.0.2.0/24 (TEST-NET-1), 198.51.100.0/24 (TEST-NET-2), 203.0.113.0/24 (TEST-NET-3)
        if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
        if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
        if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;

        // 224.0.0.0/4 (Multicast)
        if (parts[0] >= 224 && parts[0] <= 239) return true;

        // 240.0.0.0/4 (Reserved for future use)
        if (parts[0] >= 240) return true;

        return false;
    }

    // IPv6 checks
    if (ip.includes(':')) {
        const normalized = ip.toLowerCase();

        // Loopback: ::1
        if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

        // Link-local: fe80::/10
        if (normalized.startsWith('fe80:') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

        // Unique local addresses: fc00::/7 (fc00:: and fd00::)
        if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

        // IPv4-mapped IPv6: ::ffff:127.0.0.1 etc.
        if (normalized.includes('ffff:')) {
            const ipv4Part = normalized.split('ffff:').pop();
            if (ipv4Part && isIPv4(ipv4Part)) {
                return isPrivateIP(ipv4Part);
            }
        }

        // :: (unspecified)
        if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

        return false;
    }

    // Unknown format - reject to be safe
    return true;
}

function isIPv4(ip: string): boolean {
    const parts = ip.split('.');
    return parts.length === 4 && parts.every(p => {
        const n = Number(p);
        return !isNaN(n) && n >= 0 && n <= 255 && p === String(n);
    });
}
