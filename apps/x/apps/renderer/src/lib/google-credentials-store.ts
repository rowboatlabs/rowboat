interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

let credentials: GoogleCredentials | null = null;

export function getGoogleCredentials(): GoogleCredentials | null {
  return credentials;
}

export function setGoogleCredentials(clientId: string, clientSecret: string): void {
  const trimmedId = clientId.trim();
  const trimmedSecret = clientSecret.trim();
  if (!trimmedId || !trimmedSecret) {
    return;
  }
  credentials = { clientId: trimmedId, clientSecret: trimmedSecret };
}

export function clearGoogleCredentials(): void {
  credentials = null;
}
