// instrumentation-client.js
import posthog from 'posthog-js';
import { captureRouterTransitionStart} from "@sentry/nextjs";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: '2025-05-24'
});

export const onRouterTransitionStart = captureRouterTransitionStart;