type ProviderClientIdOverrides = Map<string, string>;

const providerClientIdOverrides: ProviderClientIdOverrides = new Map();

export function setProviderClientIdOverride(provider: string, clientId: string): void {
  const trimmed = clientId.trim();
  if (!trimmed) {
    return;
  }
  providerClientIdOverrides.set(provider, trimmed);
}

export function getProviderClientIdOverride(provider: string): string | undefined {
  return providerClientIdOverrides.get(provider);
}

export function hasProviderClientIdOverride(provider: string): boolean {
  return providerClientIdOverrides.has(provider);
}

export function clearProviderClientIdOverride(provider: string): void {
  providerClientIdOverrides.delete(provider);
}
