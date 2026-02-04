let googleClientId: string | null = null;

export function getGoogleClientId(): string | null {
  return googleClientId;
}

export function setGoogleClientId(clientId: string): void {
  const trimmed = clientId.trim();
  if (!trimmed) {
    return;
  }
  googleClientId = trimmed;
}

export function clearGoogleClientId(): void {
  googleClientId = null;
}
