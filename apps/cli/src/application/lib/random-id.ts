import { customAlphabet } from 'nanoid';
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz-';
const nanoid = customAlphabet(alphabet, 7);

export async function randomId(): Promise<string> {
    return nanoid();
}