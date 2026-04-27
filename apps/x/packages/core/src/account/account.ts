import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';

export async function isSignedIn(): Promise<boolean> {
    // Rowboat cloud sign-in has been removed — always use BYOK mode
    return false;
}

export async function getAccessToken(): Promise<string> {
    // Rowboat cloud access has been removed
    throw new Error('Rowboat cloud sign-in is not available. Please configure your own API keys in Settings > Models.');
}
