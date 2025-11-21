import twitterPodcast from './twitter-podcast.json' with { type: 'json' };
import gemini3Test from './gemini3-test.json' with { type: 'json' };
import { Example } from '../application/entities/example.js';
import z from 'zod';

export const examples: Record<string, z.infer<typeof Example>> = {
    "twitter-podcast": Example.parse(twitterPodcast),
    "gemini3-test": Example.parse(gemini3Test),
};