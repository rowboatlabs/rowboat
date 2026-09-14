import container from '../di/container.js';
import { IOAuthRepo, isAppSignIn } from '../auth/repo.js';

/** Signed in to the APP (auth/repo.ts isAppSignIn — one session, two uses). */
export async function isSignedIn(): Promise<boolean> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    return isAppSignIn(await oauthRepo.read('rowboat'));
}
