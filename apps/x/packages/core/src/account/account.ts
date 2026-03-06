import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';

export async function isSignedIn(): Promise<boolean> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await oauthRepo.read('rowboat');
    return !!tokens;
}
