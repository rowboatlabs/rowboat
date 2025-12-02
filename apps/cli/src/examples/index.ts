import twitterPodcast from './twitter-podcast.json' with { type: 'json' };
import { Example } from '../entities/example.js';
import z from 'zod';

export const examples: Record<string, z.infer<typeof Example>> = {
    "twitter-podcast": Example.parse(twitterPodcast),
};